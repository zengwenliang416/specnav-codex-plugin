'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const metadata = require('../../../plugins/specnav-verification/kernel/metadata');
const {
  authorityProjection,
  createRuntimeAuthority
} = require('../../../plugins/specnav-verification/kernel/runtime/authority');
const {
  writeAuthorityKey
} = require('../../../plugins/specnav-verification/kernel/runtime/authority-key');
const {
  moduleTreeDigest,
  sha256
} = require('../../../plugins/specnav-verification/kernel/runtime/runtime-integrity');
const {
  projectProviderFile
} = require('../../../plugins/specnav-verification/kernel/runtime/scope-resolver');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-authority-'));
  const runtimeBase = path.join(root, 'managed');
  const runtimeVersion = 'fixture-runtime';
  const runtimeRoot = path.join(runtimeBase, runtimeVersion);
  const moduleRoot = path.join(runtimeRoot, 'node_modules', 'fixture');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'index.js'), 'module.exports = true;\n');
  const packageLock = Buffer.from('{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(runtimeRoot, 'package-lock.json'), packageLock);
  fs.writeFileSync(path.join(runtimeRoot, 'package.json'), '{"private":true}\n');
  const lock = {
    runtime_version: runtimeVersion,
    packages: {},
    authority: {
      algorithm: 'hmac-sha256',
      relative_path: 'authority.key',
      key_bytes: 32,
      file_mode: '0600'
    },
    kernel: {
      contract_digest: metadata.contractDigest
    }
  };
  const authority = writeAuthorityKey(
    runtimeRoot,
    lock,
    () => Buffer.alloc(32, 7)
  );
  fs.writeFileSync(path.join(runtimeRoot, 'install-receipt.json'), `${
    JSON.stringify({
      schema: 'specnav.verification.runtime-install-receipt.v1',
      status: 'installed',
      runtime_version: runtimeVersion,
      kernel: {
        contract_digest: metadata.contractDigest
      },
      package_lock_sha256: sha256(packageLock),
      module_tree_sha256: moduleTreeDigest(runtimeRoot),
      authority,
      packages: [],
      browsers: [],
      fallback_used: false
    }, null, 2)
  }\n`);
  const status = {
    schema: 'specnav.verification.runtime-status.v1',
    ok: true,
    readiness: 'ready',
    runtime_version: runtimeVersion,
    runtime_root: runtimeRoot,
    runtime_scope: 'explicit',
    runtime_base: runtimeBase,
    scope_selection_source: 'runtime-argument',
    provider_scope: 'explicit',
    provider_source: 'process-environment',
    provider_file: null,
    checks: {},
    blockers: [],
    warnings: [],
    actions: [],
    fallback_used: false
  };
  return { root, runtimeBase, runtimeRoot, lock, status };
}

test('a change-authored runtime root cannot select executable modules', () => {
  const source = fixture();
  const malicious = path.join(source.root, 'malicious-runtime');
  const sentinel = path.join(source.root, 'sentinel.txt');
  fs.mkdirSync(path.join(malicious, 'node_modules', 'ajv'), {
    recursive: true
  });
  fs.writeFileSync(path.join(malicious, 'node_modules', 'ajv', 'index.js'), [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(sentinel)}, 'executed');`,
    ''
  ].join('\n'));
  const candidate = {
    ...source.status,
    runtime_root: malicious
  };

  const result = createRuntimeAuthority({
    lock: source.lock,
    runtimeBase: source.runtimeBase
  }).resolve(candidate);

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-runtime:authority-root-mismatch'
    )),
    true
  );
  assert.equal(fs.existsSync(sentinel), false);
});

test('runtime authority returns the managed signing key only after validation', () => {
  const source = fixture();
  const result = createRuntimeAuthority({
    lock: source.lock,
    runtimeBase: source.runtimeBase
  }).resolve(source.status);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.signingKey, Buffer.alloc(32, 7));
  assert.equal(
    fs.statSync(path.join(source.runtimeRoot, 'authority.key')).mode & 0o777,
    0o600
  );
});

test('runtime authority rejects a tampered managed signing key', () => {
  const source = fixture();
  fs.writeFileSync(
    path.join(source.runtimeRoot, 'authority.key'),
    Buffer.alloc(32, 8),
    { mode: 0o600 }
  );

  const result = createRuntimeAuthority({
    lock: source.lock,
    runtimeBase: source.runtimeBase
  }).resolve(source.status);

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-runtime:authority-static-check-failed'
    )),
    true
  );
});

test('module tree drift invalidates the trusted runtime before module loading', () => {
  const source = fixture();
  fs.appendFileSync(path.join(
    source.runtimeRoot,
    'node_modules',
    'fixture',
    'index.js'
  ), 'module.exports = false;\n');

  const result = createRuntimeAuthority({
    lock: source.lock,
    runtimeBase: source.runtimeBase
  }).resolve(source.status);

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-runtime:authority-receipt-invalid'
    )),
    true
  );
});

test('runtime authority projection binds runtime and provider scope', () => {
  const base = {
    runtime_version: 'fixture-runtime',
    runtime_root: '/runtime/project',
    runtime_scope: 'project',
    runtime_base: '/runtime',
    scope_selection_source: 'project-config',
    provider_scope: 'project',
    provider_source: 'scope-file',
    provider_file: '/project/.specnav/secrets/verification.env',
    requires_midscene: true
  };
  const project = authorityProjection(base);
  const user = authorityProjection({
    ...base,
    runtime_root: '/user/runtime',
    runtime_scope: 'user',
    runtime_base: '/user',
    provider_scope: 'user',
    provider_file: '/user/.specnav/secrets/verification.env'
  });

  assert.notDeepEqual(project, user);
  assert.equal(project.runtime_scope, 'project');
  assert.equal(project.provider_scope, 'project');
});

test('runtime authority rejects a provider file outside the selected project scope', () => {
  const source = fixture();
  const projectRoot = path.join(source.root, 'project');
  fs.mkdirSync(path.join(projectRoot, '.specnav'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.specnav', 'config.json'), JSON.stringify({
    schema: 'specnav.project-config.v1',
    verification: {
      runtime_scope: 'project'
    }
  }));
  const selectedBase = path.join(
    projectRoot,
    '.specnav',
    'runtime',
    'verification'
  );
  fs.mkdirSync(path.dirname(selectedBase), { recursive: true });
  fs.renameSync(source.runtimeBase, selectedBase);
  const selectedRoot = path.join(selectedBase, source.lock.runtime_version);
  const candidate = {
    ...source.status,
    runtime_root: selectedRoot,
    runtime_scope: 'project',
    runtime_base: selectedBase,
    scope_selection_source: 'project-config',
    provider_scope: 'project',
    provider_source: 'scope-file',
    provider_file: path.join(
      source.root,
      'other-project',
      '.specnav',
      'secrets',
      'verification.env'
    )
  };

  const result = createRuntimeAuthority({
    lock: source.lock,
    projectRoot
  }).resolve(candidate);

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-runtime:authority-status-invalid'
    )),
    true
  );
  assert.notEqual(candidate.provider_file, projectProviderFile(projectRoot));
});
