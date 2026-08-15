'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.join(
  ROOT,
  'plugins/specnav-verification/assets/contract-fixtures'
);
const CODEX_PLUGIN = path.join(ROOT, 'plugins/specnav-verification');
const kernel = require(CODEX_PLUGIN);
const {
  createHostAuthorityFixture
} = require('./host-authority-test-helpers');
const CLAUDE_HOST_FILES = Object.freeze([
  'commands/specnav-verification.md',
  'commands/specnav-verify.md',
  'scripts/claude-verification-adapter.js',
  'scripts/plugin-runtime.js',
  'specnav-stage.json',
  '.claude-plugin/plugin.json'
]);
const CODEFREE_HOST_FILES = Object.freeze([
  'scripts/codefree-o-verification-adapter.js',
  'scripts/plugin-runtime.js',
  'specnav-stage.json'
]);
const HOST_LOCK = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'host-lock.json'),
  'utf8'
));

function fileDigest(root, relative) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, relative)))
    .digest('hex');
}

function copyTree(t, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'plugin');
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function copyFixtures(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-drift-fixtures-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(FIXTURE_ROOT, root, { recursive: true });
  return root;
}

function snapshot(options = {}) {
  return kernel.createCompatibilitySnapshot({
    host: options.host || 'fixture',
    pluginRoot: options.pluginRoot || CODEX_PLUGIN,
    fixtureRoot: options.fixtureRoot || FIXTURE_ROOT,
    manifestFile: options.manifestFile || null,
    hostFiles: options.hostFiles || [],
    expectedSourceCommit: options.expectedSourceCommit || null
  });
}

function compare(reference, candidate) {
  return kernel.compareCompatibilitySnapshots(reference, [candidate]);
}

function blockerIds(result) {
  return result.blockers.map((entry) => entry.id);
}

function rewriteManifest(pluginRoot, mutate) {
  const manifestFile = path.join(
    pluginRoot,
    'specnav-kernel-source.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  mutate(manifest);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestFile;
}

function hostPluginFixture(t, host) {
  const fixture = createHostAuthorityFixture(t);
  return {
    fixture,
    pluginRoot: path.join(
      fixture.roots[host],
      fixture.descriptors[host].plugin
    )
  };
}

test('Codex, Claude Code, and CodeFree-O match one compatibility snapshot', (t) => {
  const hosts = createHostAuthorityFixture(t);
  const reference = snapshot({
    host: 'codex',
    pluginRoot: path.join(
      hosts.roots.codex,
      hosts.descriptors.codex.plugin
    ),
    hostFiles: hosts.descriptors.codex.hostFiles
  });
  const claudePlugin = path.join(
    hosts.roots['claude-code'],
    hosts.descriptors['claude-code'].plugin
  );
  const codefreePlugin = path.join(
    hosts.roots['codefree-o'],
    hosts.descriptors['codefree-o'].plugin
  );
  const result = kernel.compareCompatibilitySnapshots(reference, [
    snapshot({
      host: 'claude-code',
      pluginRoot: claudePlugin,
      manifestFile: path.join(
        hosts.roots['claude-code'],
        hosts.descriptors['claude-code'].manifest
      ),
      hostFiles: CLAUDE_HOST_FILES,
      expectedSourceCommit: hosts.sourceCommit
    }),
    snapshot({
      host: 'codefree-o',
      pluginRoot: codefreePlugin,
      manifestFile: path.join(
        hosts.roots['codefree-o'],
        hosts.descriptors['codefree-o'].manifest
      ),
      hostFiles: CODEFREE_HOST_FILES,
      expectedSourceCommit: hosts.sourceCommit
    })
  ]);

  assert.equal(result.ok, true, JSON.stringify(result.blockers, null, 2));
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.hosts, ['claude-code', 'codefree-o']);
});

test('kernel identity drift returns a stable release blocker', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  const metadataFile = path.join(pluginRoot, 'kernel/metadata.js');
  fs.writeFileSync(
    metadataFile,
    fs.readFileSync(metadataFile, 'utf8')
      .replace(
        "const version = '2.0.0-alpha.2';",
        "const version = '2.0.0-alpha.0';"
      )
  );
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:kernel-identity-mismatch:drifted'
  ]);
});

test('unversioned Kernel source drift cannot bypass compatibility CI', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  fs.appendFileSync(
    path.join(pluginRoot, 'kernel/runtime/doctor.js'),
    '\n// unversioned-kernel-drift\n'
  );
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:kernel-source-mismatch:drifted'
  ]);
});

test('schema checksum drift identifies the affected schema', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  const schemaFile = path.join(pluginRoot, 'schemas/test-case.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  schema.title = 'Drifted test case';
  fs.writeFileSync(schemaFile, `${JSON.stringify(schema, null, 2)}\n`);
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:schema-mismatch:drifted:test-case.schema.json'
  ]);
});

test('blocker registry drift cannot be hidden by a matching version', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  fs.appendFileSync(
    path.join(pluginRoot, 'kernel/evidence/blockers.js'),
    "\nconst undeclared = 'verification-evidence:drift-fixture';\n"
  );
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:blocker-registry-mismatch:drifted'
  ]);
});

test('normalized fixture drift is release blocking', (t) => {
  const fixtureRoot = copyFixtures(t);
  const fixtureFile = path.join(fixtureRoot, 'positive/test-case.json');
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  fixture.goal = 'Drifted fixture goal';
  fs.writeFileSync(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`);
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    fixtureRoot
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:fixture-output-mismatch:drifted'
  ]);
});

test('fixture manifest entries cannot traverse outside the fixture root', (t) => {
  const fixtureRoot = copyFixtures(t);
  const manifestFile = path.join(fixtureRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.positive[0].file = '../outside.json';
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(
    () => snapshot({
      host: 'unsafe-fixture',
      fixtureRoot
    }),
    /verification-drift:fixture-path-unsafe:unsafe-fixture/
  );
});

test('fixture manifest entries cannot follow symlinks', (t) => {
  const fixtureRoot = copyFixtures(t);
  const outside = path.join(fixtureRoot, '../outside-fixture.json');
  const fixtureFile = path.join(fixtureRoot, 'positive/test-case.json');
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.writeFileSync(outside, '{}\n');
  fs.rmSync(fixtureFile);
  fs.symlinkSync(outside, fixtureFile);

  assert.throws(
    () => snapshot({
      host: 'symlinked-fixture',
      fixtureRoot
    }),
    /verification-drift:fixture-path-unsafe:symlinked-fixture/
  );
});

test('generated report model drift is release blocking', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  const builderFile = path.join(
    pluginRoot,
    'kernel/reporting/report-model-builder.js'
  );
  fs.appendFileSync(builderFile, '\n// report-model-drift\n');
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:report-model-mismatch:drifted'
  ]);
});

test('host-owned code cannot bypass or duplicate Kernel boundaries', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  const hostFile = 'scripts/unsafe-host-adapter.js';
  fs.writeFileSync(
    path.join(pluginRoot, hostFile),
    [
      "'use strict';",
      "const { createDecisionEngine } = require('../kernel/gates');",
      'module.exports = { createDecisionEngine };',
      ''
    ].join('\n')
  );
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot,
    hostFiles: [hostFile]
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:architecture-boundary-violation:drifted:scripts/unsafe-host-adapter.js'
  ]);
});

test('missing host input fails closed without fallback', () => {
  assert.throws(
    () => kernel.createCompatibilitySnapshot({
      host: 'missing',
      pluginRoot: '/tmp/specnav-host-does-not-exist',
      fixtureRoot: FIXTURE_ROOT
    }),
    /verification-drift:plugin-root-missing:missing/
  );
});

test('omitted roots return stable input blockers', () => {
  assert.throws(
    () => kernel.createCompatibilitySnapshot({
      host: 'missing',
      fixtureRoot: FIXTURE_ROOT
    }),
    /verification-drift:plugin-root-missing:missing/
  );
  assert.throws(
    () => kernel.createCompatibilitySnapshot({
      host: 'missing',
      pluginRoot: CODEX_PLUGIN
    }),
    /verification-drift:fixture-root-missing:missing/
  );
});

test('manifest paths cannot escape the synchronized plugin root', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  const outside = path.join(pluginRoot, '../outside.txt');
  const manifestFile = path.join(pluginRoot, 'unsafe-manifest.json');
  fs.writeFileSync(outside, 'must not be read\n');
  fs.writeFileSync(manifestFile, `${JSON.stringify({
    schema: 'specnav.verification.kernel-sync.v1',
    kernel: {
      name: kernel.metadata.name,
      version: kernel.metadata.version,
      api_version: kernel.metadata.apiVersion,
      contract_version: kernel.metadata.contractVersion,
      contract_digest: kernel.metadata.contractDigest
    },
    files: ['../outside.txt'],
    source_tree_digest: '0'.repeat(64),
    host_files: []
  }, null, 2)}\n`);

  assert.throws(
    () => snapshot({
      host: 'unsafe',
      pluginRoot,
      manifestFile,
      hostFiles: ['scripts/codex-verification-adapter.js']
    }),
    /verification-drift:manifest-path-unsafe:unsafe/
  );
});

test('manifest cannot omit required host-owned files or hide rogue files', (t) => {
  const { pluginRoot } = hostPluginFixture(t, 'claude-code');
  const manifestFile = path.join(
    pluginRoot,
    'specnav-kernel-source.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.host_files = manifest.host_files.filter((entry) => (
    entry.target !== 'scripts/claude-verification-adapter.js'
  ));
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(pluginRoot, 'scripts/rogue-host-adapter.js'),
    "'use strict';\nmodule.exports = {};\n"
  );

  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot,
    manifestFile,
    hostFiles: CLAUDE_HOST_FILES
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:manifest-file-set-mismatch:drifted',
    'verification-drift:manifest-host-files-mismatch:drifted'
  ]);
});

test('host-owned wrapper bytes must match synchronized provenance', (t) => {
  const { pluginRoot } = hostPluginFixture(t, 'codefree-o');
  const manifestFile = path.join(
    pluginRoot,
    'specnav-kernel-source.json'
  );
  fs.appendFileSync(
    path.join(pluginRoot, 'scripts/codefree-o-verification-adapter.js'),
    '\n// subtle-host-drift\n'
  );
  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'drifted',
    pluginRoot,
    manifestFile,
    hostFiles: CODEFREE_HOST_FILES
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:manifest-host-file-digest-mismatch:drifted'
  ]);
});

test('updated manifest hash cannot hide transformed skill tampering', (t) => {
  const { pluginRoot } = hostPluginFixture(t, 'claude-code');
  const target = 'skills/specnav-verification/SKILL.md';
  fs.appendFileSync(path.join(pluginRoot, target), '\nTampered skill.\n');
  const manifestFile = rewriteManifest(pluginRoot, (manifest) => {
    const entry = manifest.transformed_files.find((item) => (
      item.target === target
    ));
    entry.target_sha256 = fileDigest(pluginRoot, target);
  });

  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'claude-code',
    pluginRoot,
    manifestFile,
    hostFiles: CLAUDE_HOST_FILES
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:manifest-transformed-file-provenance-mismatch:claude-code'
  ]);
});

test('updated manifest hash cannot hide generated host-file tampering', (t) => {
  const { pluginRoot } = hostPluginFixture(t, 'claude-code');
  const target = 'commands/specnav-verification.md';
  fs.appendFileSync(path.join(pluginRoot, target), '\nTampered command.\n');
  const manifestFile = rewriteManifest(pluginRoot, (manifest) => {
    const entry = manifest.host_files.find((item) => (
      item.target === target
    ));
    entry.target_sha256 = fileDigest(pluginRoot, target);
  });

  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'claude-code',
    pluginRoot,
    manifestFile,
    hostFiles: CLAUDE_HOST_FILES
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:manifest-host-file-provenance-mismatch:claude-code'
  ]);
});

test('updated tree digest cannot hide exact canonical file tampering', (t) => {
  const { pluginRoot } = hostPluginFixture(t, 'claude-code');
  const target = 'assets/icon.svg';
  fs.appendFileSync(path.join(pluginRoot, target), '\n<!-- tampered -->\n');
  const manifestFile = rewriteManifest(pluginRoot, (manifest) => {
    const records = manifest.files
      .map((relative) => (
        `${relative}\0${fileDigest(pluginRoot, relative)}`
      ))
      .sort();
    manifest.source_tree_digest = crypto
      .createHash('sha256')
      .update(records.join('\n'))
      .digest('hex');
  });

  const result = compare(snapshot({ host: 'codex' }), snapshot({
    host: 'claude-code',
    pluginRoot,
    manifestFile,
    hostFiles: CLAUDE_HOST_FILES
  }));

  assert.deepEqual(blockerIds(result), [
    'verification-drift:manifest-exact-file-provenance-mismatch:claude-code'
  ]);
});

test('missing manifest returns a stable drift blocker', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  assert.throws(
    () => snapshot({
      host: 'missing-manifest',
      pluginRoot,
      manifestFile: path.join(pluginRoot, 'missing-manifest.json'),
      hostFiles: ['scripts/codex-verification-adapter.js']
    }),
    /verification-drift:manifest-missing:missing-manifest/
  );
});

test('host manifests must bind to a clean locked source commit', (t) => {
  const { pluginRoot } = hostPluginFixture(t, 'codefree-o');
  const manifestFile = path.join(
    pluginRoot,
    'specnav-kernel-source.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.source_dirty = true;
  manifest.source_commit = '0'.repeat(40);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = snapshot({
    host: 'drifted',
    pluginRoot,
    manifestFile,
    hostFiles: CODEFREE_HOST_FILES,
    expectedSourceCommit: '1'.repeat(40)
  });

  assert.deepEqual(result.manifest.blockers, [
    'manifest-source-commit-mismatch',
    'manifest-source-dirty'
  ]);
});

test('candidate JavaScript is treated as data and never executed', (t) => {
  const pluginRoot = copyTree(t, CODEX_PLUGIN);
  const sentinel = path.join(pluginRoot, '../candidate-executed.txt');
  const metadataFile = path.join(pluginRoot, 'kernel/metadata.js');
  const canonicalFile = path.join(pluginRoot, 'kernel/cases/canonical.js');
  fs.writeFileSync(
    metadataFile,
    [
      "'use strict';",
      `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'metadata');`,
      fs.readFileSync(metadataFile, 'utf8')
    ].join('\n')
  );
  fs.writeFileSync(
    canonicalFile,
    [
      "'use strict';",
      `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'canonical');`,
      fs.readFileSync(canonicalFile, 'utf8')
    ].join('\n')
  );

  snapshot({ host: 'untrusted', pluginRoot });
  assert.equal(fs.existsSync(sentinel), false);
});

test('CI pins both downstream host repositories to immutable commits', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github/workflows/ci.yml'),
    'utf8'
  );
  assert.equal(
    HOST_LOCK.schema,
    'specnav.verification.cross-host-lock.v1'
  );
  assert.equal(HOST_LOCK.source_host, 'codex');
  assert.match(HOST_LOCK.source.commit, /^[a-f0-9]{40}$/);
  for (const [host, output] of [
    ['claude-code', 'claude_ref'],
    ['codefree-o', 'codefree_ref']
  ]) {
    assert.match(HOST_LOCK.hosts[host].commit, /^[a-f0-9]{40}$/);
    assert.match(workflow, new RegExp(`ref: \\\${{ steps\\.host-lock\\.outputs\\.${output} }}`));
  }
  assert.match(workflow, /host-lock\.json/);
});
