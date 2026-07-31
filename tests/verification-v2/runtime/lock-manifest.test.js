'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const {
  loadRuntimeLock,
  resolveRuntimeLock
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/lock-manifest'
));
const metadata = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/metadata'
));

function compatibleEnvironment(overrides = {}) {
  return {
    nodeVersion: 'v22.19.0',
    platform: 'darwin',
    arch: 'arm64',
    kernel: {
      name: metadata.name,
      version: metadata.version,
      apiVersion: metadata.apiVersion,
      contractVersion: metadata.contractVersion,
      contractDigest: metadata.contractDigest
    },
    ...overrides
  };
}

test('runtime lock pins every required package and browser artifact', () => {
  const lock = loadRuntimeLock();

  assert.equal(lock.schema, 'specnav.verification.runtime-lock.v1');
  assert.equal(lock.runtime_version, '2.0.0-alpha.1');
  assert.deepEqual(lock.kernel, {
    name: metadata.name,
    version: metadata.version,
    api_version: metadata.apiVersion,
    contract_version: metadata.contractVersion,
    contract_digest: metadata.contractDigest
  });
  assert.deepEqual(lock.platforms, ['darwin-arm64']);
  assert.deepEqual(Object.keys(lock.packages).sort(), [
    '@midscene/web',
    '@playwright/test',
    'ajv',
    'ajv-formats',
    'playwright'
  ]);
  for (const pkg of Object.values(lock.packages)) {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.match(pkg.integrity, /^sha512-/);
  }
  assert.deepEqual(
    lock.browsers.map((browser) => browser.name),
    ['chromium', 'chromium-headless-shell', 'ffmpeg']
  );
  assert.deepEqual(
    lock.browsers.map((browser) => browser.revision),
    ['1234', '1234', '1011']
  );
  for (const browser of lock.browsers) {
    const artifact = browser.artifacts['darwin-arm64'];
    assert.equal(artifact.host_platform, 'mac26-arm64');
    assert.match(
      artifact.url,
      /^https:\/\/cdn\.playwright\.dev\/builds\/(?:cft|ffmpeg)\//
    );
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(artifact.size_bytes));
    assert.ok(artifact.size_bytes > 0);
  }
});

test('resolver accepts only the exact lock and compatible environment', () => {
  const result = resolveRuntimeLock('2.0.0-alpha.1', compatibleEnvironment());

  assert.equal(result.ok, true);
  assert.equal(result.lock.runtime_version, '2.0.0-alpha.1');
  assert.deepEqual(result.blockers, []);
});

test('resolver rejects unknown runtime versions without fallback', () => {
  const result = resolveRuntimeLock('latest', compatibleEnvironment());

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ['verification-runtime:unsupported-version:latest']);
  assert.equal(result.lock, null);
});

test('resolver returns exact compatibility blockers', () => {
  const oldNode = resolveRuntimeLock(
    '2.0.0-alpha.1',
    compatibleEnvironment({ nodeVersion: 'v18.20.0' })
  );
  assert.deepEqual(oldNode.blockers, ['verification-runtime:unsupported-node:v18.20.0']);

  const badPlatform = resolveRuntimeLock(
    '2.0.0-alpha.1',
    compatibleEnvironment({ platform: 'freebsd', arch: 'x64' })
  );
  assert.deepEqual(badPlatform.blockers, ['verification-runtime:unsupported-platform:freebsd-x64']);
});

test('resolver blocks missing or mismatched kernel identity without defaults', () => {
  const missingKernel = resolveRuntimeLock('2.0.0-alpha.1', {
    nodeVersion: 'v22.19.0',
    platform: 'darwin',
    arch: 'arm64'
  });
  assert.deepEqual(missingKernel.blockers, [
    'verification-runtime:missing-kernel-identity'
  ]);

  for (const [field, value, expectedBlocker] of [
    ['name', '@specnav/wrong-kernel', 'verification-runtime:kernel-name-mismatch:@specnav/wrong-kernel'],
    ['version', '2.0.0-alpha.2', 'verification-runtime:kernel-version-mismatch:2.0.0-alpha.2'],
    ['apiVersion', 'specnav.verification.kernel.v2', 'verification-runtime:kernel-api-version-mismatch:specnav.verification.kernel.v2'],
    ['contractVersion', 2, 'verification-runtime:kernel-contract-version-mismatch:2'],
    ['contractDigest', '0'.repeat(64), `verification-runtime:kernel-contract-digest-mismatch:${'0'.repeat(64)}`]
  ]) {
    const environment = compatibleEnvironment();
    environment.kernel[field] = value;
    const result = resolveRuntimeLock('2.0.0-alpha.1', environment);
    assert.deepEqual(result.blockers, [expectedBlocker]);
    assert.equal(result.lock, null);
  }
});
