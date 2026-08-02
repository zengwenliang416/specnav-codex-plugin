'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const CODEFREE_ROOT = path.resolve(ROOT, '../specnav-codefree-o-plugin');
const {
  createCodeFreeOVerificationAdapter
} = require(path.join(
  ROOT,
  'integrations/codefree-o/codefree-o-verification-adapter'
));
const kernel = require(path.join(ROOT, 'plugins/specnav-verification'));
const {
  synchronize
} = require(path.join(
  ROOT,
  'integrations/codefree-o/sync-verification-module'
));

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
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
}

function createCodeFreeTarget(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-codefree-sync-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, 'package.json'), {
    name: 'specnav-codefree-o-plugin',
    version: '0.1.0'
  });
  writeJson(path.join(root, 'specnav.manifest.json'), {
    schema: 'specnav.hostPackage.v1',
    modules: [{
      name: 'specnav-verification',
      path: 'modules/specnav-verification'
    }]
  });
  writeJson(
    path.join(
      root,
      'modules/specnav-verification/specnav-stage.json'
    ),
    {
      schema: 'specnav.stagePlugin.v1',
      plugin: 'specnav-verification'
    }
  );
  fs.mkdirSync(
    path.join(root, 'modules/specnav-verification/scripts'),
    { recursive: true }
  );
  fs.writeFileSync(
    path.join(
      root,
      'modules/specnav-verification/scripts/plugin-runtime.js'
    ),
    "'use strict';\nmodule.exports = {};\n"
  );
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\n');
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

function snapshot(root) {
  const result = {};
  for (const entry of fs.readdirSync(root, {
    recursive: true,
    withFileTypes: true
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    result[path.relative(root, file)] = sha256(file);
  }
  return result;
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

test('CodeFree-O describes the canonical full Verification contract', () => {
  const adapter = createCodeFreeOVerificationAdapter({
    execute() {
      throw new Error('describe-must-not-execute');
    }
  });
  const description = adapter.describe();

  assert.equal(description.host, 'codefree-o');
  assert.deepEqual(description.kernel, kernel.metadata);
  assert.deepEqual(description.required_domains, kernel.SIX_DOMAINS);
  assert.equal(description.verification_mode, 'full');
  assert.equal(description.light_mode_supported, false);
  assert.equal(description.fallback_supported, false);
  assert.equal(description.manual_green_supported, false);
});

test('CodeFree-O preserves shared blockers and artifacts', () => {
  const source = {
    ok: false,
    verdict: 'blocked',
    fallback_used: false,
    blockers: [{
      id: 'verification-runtime:not-ready',
      artifact: 'verify/runtime-evidence.json',
      detail: 'browser-missing'
    }],
    artifacts: [{
      path: 'verify/runtime-evidence.json'
    }]
  };
  const adapter = createCodeFreeOVerificationAdapter({
    execute() {
      return { exit_status: 2, signal: null, result: source };
    }
  });
  const response = adapter.invoke({
    action: 'validate',
    project_root: '/tmp/specnav-codefree-o-project'
  });

  assert.equal(response.ok, false);
  assert.equal(response.host, 'codefree-o');
  assert.deepEqual(response.blocker_ids, [
    'verification-runtime:not-ready'
  ]);
  assert.deepEqual(response.artifact_paths, [
    'verify/runtime-evidence.json'
  ]);
  assert.equal(response.fallback_used, false);
});

test('CodeFree-O blocks partial, fallback, and manual-green requests', () => {
  let calls = 0;
  const adapter = createCodeFreeOVerificationAdapter({
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
    const response = adapter.invoke(request);
    assert.equal(response.ok, false);
    assert.deepEqual(response.blocker_ids, [
      'codefree-o-verification:full-gate-required'
    ]);
  }
  assert.equal(calls, 0);
});

test('CodeFree-O requires explicit approval for runtime and migration writes', () => {
  let calls = 0;
  const adapter = createCodeFreeOVerificationAdapter({
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
    const blocked = adapter.invoke({
      action,
      project_root: '/tmp/project'
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.blocker_ids[0], /approval-required$/);
  }
  assert.equal(calls, 0);

  const approved = adapter.invoke({
    action: 'runtime-setup',
    project_root: '/tmp/project',
    approved: true
  });
  assert.equal(approved.ok, true);
  assert.equal(calls, 1);
});

test('CodeFree-O exposes forbidden or undisclosed downstream fallback', () => {
  for (const source of [
    { ok: true, fallback_used: true, blockers: [] },
    { ok: true, blockers: [] }
  ]) {
    const adapter = createCodeFreeOVerificationAdapter({
      execute() {
        return { exit_status: 0, signal: null, result: source };
      }
    });
    const result = adapter.invoke({
      action: 'validate',
      project_root: '/tmp/project'
    });
    assert.equal(result.ok, false);
    assert.match(
      result.blocker_ids[0],
      /source-fallback-(?:forbidden|undisclosed)$/
    );
  }
});

test('CodeFree-O fails closed for invalid requests and source results', () => {
  const unsupported = createCodeFreeOVerificationAdapter({
    execute() {
      throw new Error('unsupported-must-not-execute');
    }
  }).invoke({
    action: 'green',
    project_root: '/tmp/project'
  });
  assert.deepEqual(unsupported.blocker_ids, [
    'codefree-o-verification:unsupported-action:green'
  ]);

  const missingProject = createCodeFreeOVerificationAdapter({
    execute() {
      throw new Error('missing-project-must-not-execute');
    }
  }).invoke({
    action: 'validate'
  });
  assert.deepEqual(missingProject.blocker_ids, [
    'codefree-o-verification:project-root-required'
  ]);

  const invalid = createCodeFreeOVerificationAdapter({
    execute() {
      return { exit_status: 0, signal: null, result: null };
    }
  }).invoke({
    action: 'validate',
    project_root: '/tmp/project'
  });
  assert.deepEqual(invalid.blocker_ids, [
    'codefree-o-verification:invalid-source-result'
  ]);
});

test('CodeFree-O host wrapper remains invocation-only', () => {
  const source = fs.readFileSync(
    path.join(
      ROOT,
      'integrations/codefree-o/codefree-o-verification-adapter.js'
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /createSixDomainAggregator/);
  assert.doesNotMatch(source, /createDecisionEngine/);
  assert.doesNotMatch(source, /createReadingEvaluator/);
  assert.doesNotMatch(source, /release\.status\s*=/);
});

test('CodeFree-O repository consumes the canonical Verification Kernel', () => {
  const pluginRoot = path.join(
    CODEFREE_ROOT,
    'modules/specnav-verification'
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(pluginRoot, 'specnav-kernel-source.json'),
      'utf8'
    )
  );

  assert.equal(manifest.schema, 'specnav.verification.kernel-sync.v1');
  assert.equal(manifest.source_repository, 'specnav-codex-plugin');
  assert.equal(manifest.host, 'codefree-o');
  assert.equal(manifest.kernel.contract_digest, kernel.metadata.contractDigest);
  assert.equal(
    fs.existsSync(
      path.join(
        pluginRoot,
        'scripts/codefree-o-verification-adapter.js'
      )
    ),
    true
  );
  for (const relative of manifest.files) {
    assert.equal(
      sha256(path.join(ROOT, 'plugins/specnav-verification', relative)),
      sha256(path.join(pluginRoot, relative)),
      relative
    );
  }
  for (const entry of manifest.host_files) {
    assert.equal(
      entry.target_sha256,
      sha256(path.join(pluginRoot, entry.target)),
      entry.target
    );
  }
  assert.deepEqual(
    Object.keys(snapshot(pluginRoot)).sort(),
    expectedSynchronizedFiles(manifest)
  );
});

test('CodeFree-O synchronization preserves unrelated dirty files', (t) => {
  const root = createCodeFreeTarget(t);
  fs.writeFileSync(path.join(root, 'README.md'), 'local README edit\n');

  const manifest = synchronize(root);

  assert.equal(
    fs.readFileSync(path.join(root, 'README.md'), 'utf8'),
    'local README edit\n'
  );
  assert.equal(manifest.host, 'codefree-o');
  assert.match(
    spawnSync('git', ['status', '--porcelain', '--', 'README.md'], {
      cwd: root,
      encoding: 'utf8'
    }).stdout,
    /README\.md/
  );
});

test('CodeFree-O synchronization blocks owned-path conflicts', (t) => {
  const root = createCodeFreeTarget(t);
  const stageFile = path.join(
    root,
    'modules/specnav-verification/specnav-stage.json'
  );
  fs.writeFileSync(stageFile, '{}\n');

  assert.throws(
    () => synchronize(root),
    /owned-path-dirty/
  );
  assert.equal(fs.readFileSync(stageFile, 'utf8'), '{}\n');
});

test('CodeFree-O synchronization removes undeclared module files', (t) => {
  const root = createCodeFreeTarget(t);
  const rogueFile = path.join(
    root,
    'modules/specnav-verification/scripts/rogue.js'
  );
  fs.writeFileSync(rogueFile, "'use strict';\n");
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=SpecNav Tests',
    '-c',
    'user.email=specnav@example.invalid',
    'commit',
    '-qm',
    'add rogue fixture'
  ]);

  const manifest = synchronize(root);

  assert.equal(fs.existsSync(rogueFile), false);
  assert.deepEqual(
    Object.keys(snapshot(path.join(
      root,
      'modules/specnav-verification'
    ))).sort(),
    expectedSynchronizedFiles(manifest)
  );
});

test('CodeFree-O synchronization rejects ancestor symlink escapes', (t) => {
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-codefree-outside-')
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  writeJson(
    path.join(outside, 'specnav-verification/specnav-stage.json'),
    {
      schema: 'specnav.stagePlugin.v1',
      plugin: 'specnav-verification'
    }
  );
  fs.mkdirSync(
    path.join(outside, 'specnav-verification/scripts'),
    { recursive: true }
  );
  fs.writeFileSync(
    path.join(outside, 'specnav-verification/scripts/plugin-runtime.js'),
    "'use strict';\nmodule.exports = {};\n"
  );
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside\n');

  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-codefree-symlink-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, 'package.json'), {
    name: 'specnav-codefree-o-plugin',
    version: '0.1.0'
  });
  writeJson(path.join(root, 'specnav.manifest.json'), {
    schema: 'specnav.hostPackage.v1',
    modules: [{
      name: 'specnav-verification',
      path: 'modules/specnav-verification'
    }]
  });
  fs.symlinkSync(outside, path.join(root, 'modules'), 'dir');
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

  assert.throws(
    () => synchronize(root),
    /ancestor-symlink-forbidden:verification-module:modules/
  );
  assert.equal(
    fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'),
    'outside\n'
  );
});

test('CodeFree-O synchronization failure leaves the module unchanged', (t) => {
  const root = createCodeFreeTarget(t);
  const moduleRoot = path.join(root, 'modules/specnav-verification');
  const before = snapshot(moduleRoot);

  assert.throws(
    () => synchronize(root, {
      beforeCommit() {
        throw new Error('fixture-before-commit-failure');
      }
    }),
    /fixture-before-commit-failure/
  );
  assert.deepEqual(snapshot(moduleRoot), before);
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'modules'))
      .filter((name) => name.startsWith('.specnav-verification-sync-')),
    []
  );
});
