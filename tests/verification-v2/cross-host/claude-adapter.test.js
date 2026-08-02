'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const CLAUDE_ROOT = path.resolve(ROOT, '../specnav-claude-plugin');
const SOURCE_PLUGIN = path.join(ROOT, 'plugins/specnav-verification');
const CLAUDE_PLUGIN = path.join(CLAUDE_ROOT, 'plugins/specnav-verification');
const kernel = require(SOURCE_PLUGIN);
const {
  createClaudeVerificationAdapter
} = require(path.join(
  ROOT,
  'integrations/claude-code/claude-verification-adapter'
));
const {
  synchronize
} = require(path.join(
  ROOT,
  'integrations/claude-code/sync-verification-plugin'
));
const SYNC_SCRIPT = path.join(
  ROOT,
  'integrations/claude-code/sync-verification-plugin.js'
);

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function treeDigest(root, relativeFiles) {
  const records = relativeFiles
    .map((relative) => `${relative}\0${sha256(path.join(root, relative))}`)
    .sort();
  return crypto
    .createHash('sha256')
    .update(records.join('\n'))
    .digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(repository, args) {
  const result = spawnSync('git', args, {
    cwd: repository,
    encoding: 'utf8'
  });
  assert.equal(
    result.status,
    0,
    `${args.join(' ')}\n${result.stderr}`
  );
  return result.stdout.trim();
}

function createClaudeTarget(t, options = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-claude-sync-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, '.claude-plugin/marketplace.json'), {
    name: 'specnav-marketplace',
    plugins: [{
      name: 'specnav-verification',
      source: './plugins/specnav-verification'
    }]
  });
  if (options.pluginsSymlinkTarget) {
    fs.symlinkSync(options.pluginsSymlinkTarget, path.join(root, 'plugins'));
  } else {
    writeJson(
      path.join(
        root,
        'plugins/specnav-verification/.claude-plugin/plugin.json'
      ),
      {
        name: 'specnav-verification',
        version: '0.7.0',
        description: 'fixture'
      }
    );
    fs.writeFileSync(
      path.join(root, 'plugins/specnav-verification/local-marker.txt'),
      'preserve me\n'
    );
    fs.mkdirSync(
      path.join(root, 'plugins/specnav-verification/scripts'),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(
        root,
        'plugins/specnav-verification/scripts/plugin-runtime.js'
      ),
      "'use strict';\nmodule.exports = {};\n"
    );
  }
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=SpecNav Tests',
    '-c',
    'user.email=specnav@example.invalid',
    'commit',
    '-qm',
    'fixture'
  ]);
  return root;
}

function snapshotTree(root) {
  const snapshot = {};
  for (const entry of fs.readdirSync(root, {
    recursive: true,
    withFileTypes: true
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    snapshot[path.relative(root, file)] = sha256(file);
  }
  return snapshot;
}

function expectedSynchronizedFiles(manifest) {
  return [
    ...manifest.files,
    ...manifest.transformed_files.map((entry) => entry.target),
    ...manifest.host_files.map((entry) => entry.target),
    ...manifest.host_runtime_files.map((entry) => entry.target),
    'specnav-kernel-source.json'
  ].sort();
}

function blockedSourceResult() {
  return {
    ok: false,
    verdict: 'blocked',
    fallback_used: false,
    blockers: [
      'verify:user-test-cases-unapproved',
      {
        id: 'verification-runtime:not-ready',
        artifact: 'verify/runtime-evidence.json',
        detail: 'browser-missing'
      }
    ],
    artifacts: [{
      name: 'runtime-evidence.json',
      path: 'verify/runtime-evidence.json',
      ok: false
    }]
  };
}

test('Claude Code describes the same full Verification 2.0 Kernel contract', () => {
  const adapter = createClaudeVerificationAdapter({
    execute() {
      throw new Error('describe-must-not-execute');
    }
  });
  const description = adapter.describe();

  assert.equal(description.schema, 'specnav.verification.host-adapter.v1');
  assert.equal(description.host, 'claude-code');
  assert.equal(description.plugin, 'specnav-verification');
  assert.deepEqual(description.kernel, kernel.metadata);
  assert.deepEqual(description.required_domains, kernel.SIX_DOMAINS);
  assert.equal(description.verification_mode, 'full');
  assert.equal(description.light_mode_supported, false);
  assert.equal(description.fallback_supported, false);
  assert.equal(description.manual_green_supported, false);
});

test('Claude Code preserves exact blockers and report artifact paths', () => {
  const calls = [];
  const source = blockedSourceResult();
  const adapter = createClaudeVerificationAdapter({
    execute(request) {
      calls.push(structuredClone(request));
      return { exit_status: 2, signal: null, result: source };
    }
  });

  const response = adapter.invoke({
    action: 'validate',
    project_root: '/tmp/specnav-claude-project'
  });

  assert.deepEqual(calls, [{
    action: 'validate',
    project_root: '/tmp/specnav-claude-project',
    options: {}
  }]);
  assert.equal(response.ok, false);
  assert.equal(response.status, 'blocked');
  assert.equal(response.host, 'claude-code');
  assert.deepEqual(response.blocker_ids, [
    'verification-runtime:not-ready',
    'verify:user-test-cases-unapproved'
  ]);
  assert.deepEqual(response.artifact_paths, [
    'verify/runtime-evidence.json'
  ]);
  assert.deepEqual(response.next_skills, [
    'specnav-verification-runtime-status',
    'specnav-verify-plan'
  ]);
  assert.equal(response.fallback_used, false);
});

test('Claude Code blocks partial verification, fallback, and manual green', () => {
  let calls = 0;
  const adapter = createClaudeVerificationAdapter({
    execute() {
      calls += 1;
      return {
        exit_status: 0,
        signal: null,
        result: { ok: true, fallback_used: false }
      };
    }
  });

  for (const request of [
    { action: 'validate', project_root: '/tmp/project', mode: 'light' },
    { action: 'aggregate', project_root: '/tmp/project', fallback: true },
    { action: 'report', project_root: '/tmp/project', manual_green: true },
    {
      action: 'validate',
      project_root: '/tmp/project',
      required_domains: ['unit']
    }
  ]) {
    const result = adapter.invoke(request);
    assert.equal(result.ok, false);
    assert.deepEqual(result.blocker_ids, [
      'claude-verification:full-gate-required'
    ]);
    assert.equal(result.fallback_used, false);
  }
  assert.equal(calls, 0);
});

test('Claude Code requires explicit approval for runtime and migration writes', () => {
  let calls = 0;
  const adapter = createClaudeVerificationAdapter({
    execute() {
      calls += 1;
      return {
        exit_status: 0,
        signal: null,
        result: { ok: true, fallback_used: false }
      };
    }
  });

  for (const action of [
    'runtime-setup',
    'runtime-repair',
    'migrate-apply',
    'migrate-rollback'
  ]) {
    const result = adapter.invoke({
      action,
      project_root: '/tmp/project'
    });
    assert.equal(result.ok, false);
    assert.match(result.blocker_ids[0], /approval-required$/);
  }
  assert.equal(calls, 0);
});

test('Claude Code exposes forbidden or undisclosed downstream fallback', () => {
  for (const source of [
    { ok: true, fallback_used: true, blockers: [] },
    { ok: true, blockers: [] }
  ]) {
    const adapter = createClaudeVerificationAdapter({
      execute() {
        return { exit_status: 0, signal: null, result: source };
      }
    });
    const result = adapter.invoke({
      action: 'validate',
      project_root: '/tmp/project'
    });
    assert.equal(result.ok, false);
    assert.match(result.blocker_ids[0], /source-fallback-(?:forbidden|undisclosed)$/);
  }
});

test('Claude Code repository consumes the synchronized canonical Kernel', () => {
  const manifestFile = path.join(
    CLAUDE_PLUGIN,
    'specnav-kernel-source.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  assert.equal(manifest.schema, 'specnav.verification.kernel-sync.v1');
  assert.equal(manifest.kernel.name, kernel.metadata.name);
  assert.equal(manifest.kernel.version, kernel.metadata.version);
  assert.equal(
    manifest.kernel.contract_digest,
    kernel.metadata.contractDigest
  );
  assert.equal(manifest.source_repository, 'specnav-codex-plugin');
  assert.equal(manifest.generated, true);
  assert.match(manifest.source_tree_digest, /^[a-f0-9]{64}$/);
  assert.equal(
    manifest.source_tree_digest,
    treeDigest(SOURCE_PLUGIN, manifest.files)
  );

  for (const relative of manifest.files) {
    assert.equal(
      sha256(path.join(SOURCE_PLUGIN, relative)),
      sha256(path.join(CLAUDE_PLUGIN, relative)),
      relative
    );
  }
  for (const entry of manifest.host_files) {
    assert.match(entry.target_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      entry.target_sha256,
      sha256(path.join(CLAUDE_PLUGIN, entry.target)),
      entry.target
    );
  }
});

test('Claude synchronizer rejects the wrong repository before writes', (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-wrong-sync-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'sentinel.txt'), 'unchanged\n');
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=SpecNav Tests',
    '-c',
    'user.email=specnav@example.invalid',
    'commit',
    '-qm',
    'fixture'
  ]);

  assert.throws(
    () => synchronize(root),
    /target-identity-missing:marketplace/
  );
  assert.equal(
    fs.readFileSync(path.join(root, 'sentinel.txt'), 'utf8'),
    'unchanged\n'
  );
  assert.equal(fs.existsSync(path.join(root, 'plugins')), false);
});

test('Claude synchronizer refuses dirty targets and dirty overrides', (t) => {
  const root = createClaudeTarget(t);
  const marker = path.join(
    root,
    'plugins/specnav-verification/local-marker.txt'
  );
  fs.writeFileSync(marker, 'local edit\n');

  assert.throws(
    () => synchronize(root),
    /target-worktree-dirty/
  );
  const override = spawnSync(process.execPath, [
    SYNC_SCRIPT,
    '--target',
    root,
    '--apply',
    '--allow-dirty'
  ], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.notEqual(override.status, 0);
  assert.match(override.stderr, /dirty-override-forbidden/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'local edit\n');
});

test('Claude synchronizer rejects ancestor symlink escapes', (t) => {
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-sync-outside-')
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  writeJson(
    path.join(
      outside,
      'specnav-verification/.claude-plugin/plugin.json'
    ),
    { name: 'specnav-verification', version: '0.7.0' }
  );
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside\n');
  const root = createClaudeTarget(t, {
    pluginsSymlinkTarget: outside
  });

  assert.throws(
    () => synchronize(root),
    /ancestor-symlink-forbidden:plugin-root:plugins/
  );
  assert.equal(
    fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'),
    'outside\n'
  );
  assert.equal(
    fs.existsSync(path.join(outside, 'specnav-verification/package.json')),
    false
  );
});

test('Claude synchronizer leaves no partial writes when staging fails', (t) => {
  const root = createClaudeTarget(t);
  const pluginRoot = path.join(root, 'plugins/specnav-verification');
  const before = snapshotTree(pluginRoot);

  assert.throws(
    () => synchronize(root, {
      beforeCommit() {
        throw new Error('fixture-before-commit-failure');
      }
    }),
    /fixture-before-commit-failure/
  );
  assert.deepEqual(snapshotTree(pluginRoot), before);
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'plugins'))
      .filter((name) => name.startsWith('.specnav-verification-sync-')),
    []
  );
});

test('Claude synchronizer commits one validated tree with host provenance', (t) => {
  const root = createClaudeTarget(t);
  const pluginRoot = path.join(root, 'plugins/specnav-verification');
  const manifest = synchronize(root);

  assert.equal(fs.existsSync(path.join(pluginRoot, 'local-marker.txt')), false);
  assert.ok(manifest.host_files.length >= 5);
  for (const entry of manifest.host_files) {
    assert.match(entry.target_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      entry.target_sha256,
      sha256(path.join(pluginRoot, entry.target)),
      entry.target
    );
  }
  assert.deepEqual(
    manifest.host_runtime_files.map((entry) => entry.target),
    ['scripts/plugin-runtime.js']
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(pluginRoot, 'specnav-kernel-source.json'),
        'utf8'
      )
    ),
    manifest
  );
  assert.deepEqual(
    Object.keys(snapshotTree(pluginRoot)).sort(),
    expectedSynchronizedFiles(manifest)
  );
});

test('Claude host code remains invocation-only', () => {
  const source = fs.readFileSync(
    path.join(
      ROOT,
      'integrations/claude-code/claude-verification-adapter.js'
    ),
    'utf8'
  );

  assert.doesNotMatch(source, /createSixDomainAggregator/);
  assert.doesNotMatch(source, /createDecisionEngine/);
  assert.doesNotMatch(source, /createReadingEvaluator/);
  assert.doesNotMatch(source, /domain_results\s*=/);
  assert.doesNotMatch(source, /release\.status\s*=/);
});
