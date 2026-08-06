'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const metadata = require('../../../plugins/specnav-verification/kernel/metadata');
const {
  createRuntimeAuthority
} = require('../../../plugins/specnav-verification/kernel/runtime/authority');
const {
  writeAuthorityKey
} = require('../../../plugins/specnav-verification/kernel/runtime/authority-key');
const {
  moduleTreeDigest,
  sha256
} = require('../../../plugins/specnav-verification/kernel/runtime/runtime-integrity');

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
