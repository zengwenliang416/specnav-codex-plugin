'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const metadata = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/metadata'
));
const { loadRuntimeLock } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/lock-manifest'
));
const {
  browserDirectoryName,
  browserExecutableRelativePath,
  sha256File
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/installer'
));
const {
  defaultProbeBrowser,
  doctorRuntime
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/doctor'
));
const { repairRuntime } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/repair'
));
const { moduleTreeDigest } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/runtime-integrity'
));

test('doctor probes FFmpeg with its supported version argument', () => {
  const calls = [];
  const result = defaultProbeBrowser({
    browser: { name: 'ffmpeg' },
    executable: '/managed/ffmpeg',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'ffmpeg version', stderr: '' };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, ['-version']);
});

function environment() {
  return {
    nodeVersion: process.version,
    platform: 'darwin',
    arch: 'arm64',
    kernel: {
      name: metadata.name,
      version: metadata.version,
      apiVersion: metadata.apiVersion,
      contractVersion: metadata.contractVersion,
      contractDigest: metadata.contractDigest
    }
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function packageLock(lock) {
  const packages = { '': { name: 'specnav-verification-runtime' } };
  for (const [name, spec] of Object.entries(lock.packages)) {
    packages[`node_modules/${name}`] = {
      version: spec.version,
      integrity: spec.integrity
    };
  }
  return {
    name: 'specnav-verification-runtime',
    version: lock.runtime_version,
    lockfileVersion: lock.package_manager.lockfile_version,
    packages
  };
}

function runtimeFixture(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-doctor-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const lock = JSON.parse(JSON.stringify(loadRuntimeLock()));
  const runtimeBase = path.join(sandbox, 'verification');
  const runtimeRoot = path.join(runtimeBase, lock.runtime_version);
  fs.mkdirSync(runtimeRoot, { recursive: true });

  writeJson(path.join(runtimeRoot, 'package.json'), {
    name: 'specnav-verification-runtime',
    version: lock.runtime_version,
    private: true
  });
  writeJson(path.join(runtimeRoot, 'package-lock.json'), packageLock(lock));
  for (const [name, spec] of Object.entries(lock.packages)) {
    writeJson(
      path.join(runtimeRoot, 'node_modules', ...name.split('/'), 'package.json'),
      { name, version: spec.version }
    );
  }

  const browserReceipts = [];
  for (const browser of lock.browsers) {
    const directoryName = browserDirectoryName(browser);
    const executableRelative = browserExecutableRelativePath(browser, 'darwin-arm64');
    const browserRoot = path.join(runtimeRoot, 'browsers', directoryName);
    const executable = path.join(browserRoot, executableRelative);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '#!/bin/sh\necho fixture-browser\n');
    fs.chmodSync(executable, 0o755);
    fs.writeFileSync(path.join(browserRoot, 'INSTALLATION_COMPLETE'), '');
    const artifact = browser.artifacts['darwin-arm64'];
    browserReceipts.push({
      name: browser.name,
      revision: browser.revision,
      browser_version: browser.browser_version,
      url: artifact.url,
      sha256: artifact.sha256,
      size_bytes: artifact.size_bytes,
      directory: path.posix.join('browsers', directoryName),
      executable: path.posix.join(
        'browsers',
        directoryName,
        ...executableRelative.split(path.sep)
      ),
      executable_sha256: sha256File(executable),
      integrity_verified: true
    });
  }

  const receipt = {
    schema: 'specnav.verification.runtime-install-receipt.v1',
    status: 'installed',
    runtime_version: lock.runtime_version,
    platform: 'darwin-arm64',
    node_version: process.version,
    kernel: {
      name: lock.kernel.name,
      version: lock.kernel.version,
      api_version: lock.kernel.api_version,
      contract_version: lock.kernel.contract_version,
      contract_digest: lock.kernel.contract_digest
    },
    package_lock_sha256: sha256File(path.join(runtimeRoot, 'package-lock.json')),
    module_tree_sha256: moduleTreeDigest(runtimeRoot),
    packages: Object.entries(lock.packages).map(([name, spec]) => ({
      name,
      version: spec.version,
      integrity: spec.integrity,
      integrity_verified: true
    })),
    browsers: browserReceipts,
    project_manifests: [],
    fallback_used: false
  };
  writeJson(path.join(runtimeRoot, 'install-receipt.json'), receipt);

  return {
    lock,
    runtimeBase,
    runtimeRoot,
    adapters: {
      accessPath() {
        return true;
      },
      loadPackage({ name, expectedVersion }) {
        return { ok: true, name, version: expectedVersion };
      },
      probeBrowser({ browser }) {
        return {
          ok: true,
          status: 0,
          stdout: `${browser.name} fixture version`,
          stderr: ''
        };
      }
    }
  };
}

function blockerIds(result) {
  return result.blockers.map((blocker) => blocker.id);
}

function warningIds(result) {
  return result.warnings.map((warning) => warning.id);
}

test('doctor reports a complete ready runtime without exposing provider secrets', (t) => {
  const fixture = runtimeFixture(t);
  const result = doctorRuntime({
    requestedVersion: fixture.lock.runtime_version,
    environment: environment(),
    providerEnvironment: {
      MIDSCENE_MODEL_NAME: 'private-model-name',
      MIDSCENE_MODEL_FAMILY: 'openai',
      MIDSCENE_MODEL_API_KEY: 'super-secret-api-key',
      MIDSCENE_MODEL_BASE_URL: 'https://private-provider.example/v1'
    },
    requiresMidscene: true,
    runtimeBase: fixture.runtimeBase,
    lock: fixture.lock,
    adapters: fixture.adapters
  });

  assert.equal(result.ok, true);
  assert.equal(result.readiness, 'ready');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checks.packages.every((entry) => entry.loadable), true);
  assert.equal(result.checks.browsers.every((entry) => entry.probe_ok), true);
  assert.deepEqual(result.checks.provider, {
    configured: true,
    model_name_present: true,
    model_family_present: true,
    credential_source: 'MIDSCENE_MODEL_API_KEY',
    base_url_present: true,
    configuration_fingerprint:
      '592ea340dfbe18443d5e739bce9cbb2ef3f42e36680088c4948782ea7fc426ea',
    secret_values_exposed: false
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('super-secret-api-key'), false);
  assert.equal(serialized.includes('private-model-name'), false);
  assert.equal(serialized.includes('private-provider.example'), false);
});

test('doctor distinguishes optional and required Midscene provider configuration', (t) => {
  const fixture = runtimeFixture(t);
  const optional = doctorRuntime({
    requestedVersion: fixture.lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    requiresMidscene: false,
    runtimeBase: fixture.runtimeBase,
    lock: fixture.lock,
    adapters: fixture.adapters
  });
  assert.equal(optional.ok, true);
  assert.deepEqual(warningIds(optional), [
    'verification-runtime:midscene-provider-not-configured'
  ]);

  const required = doctorRuntime({
    requestedVersion: fixture.lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    requiresMidscene: true,
    runtimeBase: fixture.runtimeBase,
    lock: fixture.lock,
    adapters: fixture.adapters
  });
  assert.equal(required.ok, false);
  assert.deepEqual(blockerIds(required), [
    'verification-runtime:midscene-provider-not-configured'
  ]);
});

test('doctor returns an exact install action when the locked runtime is absent', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-missing-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const lock = loadRuntimeLock();
  const result = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    runtimeBase: path.join(sandbox, 'verification'),
    lock,
    installCommand: 'node verification-runtime.js install --version 2.0.0-alpha.1'
  });

  assert.equal(result.ok, false);
  assert.deepEqual(blockerIds(result), ['verification-runtime:runtime-missing']);
  assert.deepEqual(result.actions, [{
    id: 'verification-runtime:install-required',
    command: 'node verification-runtime.js install --version 2.0.0-alpha.1'
  }]);
  assert.equal(result.fallback_used, false);
});

test('doctor returns explicit remediation for corrupt locks and incompatible environments', () => {
  const lock = loadRuntimeLock();
  const pluginRepairCommand = 'codex plugin marketplace upgrade specnav-marketplace --json';
  const environmentRepairCommand = 'use Node.js 20-24 on darwin-arm64, then rerun verification-runtime doctor';

  const corruptLock = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    lock: null,
    pluginRepairCommand
  });
  assert.equal(corruptLock.ok, false);
  assert.equal(
    blockerIds(corruptLock).includes('verification-runtime:lock-corrupt'),
    true
  );
  assert.deepEqual(corruptLock.actions, [{
    id: 'verification-runtime:plugin-repair-required',
    command: pluginRepairCommand
  }]);

  const incompatible = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: {
      ...environment(),
      nodeVersion: 'v18.20.0'
    },
    providerEnvironment: {},
    lock,
    environmentRepairCommand
  });
  assert.equal(incompatible.ok, false);
  assert.equal(
    blockerIds(incompatible).includes('verification-runtime:unsupported-node:v18.20.0'),
    true
  );
  assert.deepEqual(incompatible.actions, [{
    id: 'verification-runtime:environment-repair-required',
    command: environmentRepairCommand
  }]);
});

test('doctor blocks tampered locks, missing browsers, and unloadable packages', (t) => {
  for (const defect of ['lock', 'browser', 'package']) {
    const fixture = runtimeFixture(t);
    const adapters = { ...fixture.adapters };
    if (defect === 'lock') {
      fs.appendFileSync(path.join(fixture.runtimeRoot, 'package-lock.json'), '\n');
    } else if (defect === 'browser') {
      const browser = fixture.lock.browsers[0];
      fs.rmSync(path.join(
        fixture.runtimeRoot,
        'browsers',
        browserDirectoryName(browser),
        browserExecutableRelativePath(browser, 'darwin-arm64')
      ));
    } else {
      adapters.loadPackage = ({ name, expectedVersion }) => (
        name === 'ajv'
          ? { ok: false, name, version: expectedVersion, error: 'fixture-load-failed' }
          : { ok: true, name, version: expectedVersion }
      );
    }

    const result = doctorRuntime({
      requestedVersion: fixture.lock.runtime_version,
      environment: environment(),
      providerEnvironment: {},
      runtimeBase: fixture.runtimeBase,
      lock: fixture.lock,
      adapters
    });
    const expected = {
      lock: 'verification-runtime:package-lock-integrity-mismatch',
      browser: 'verification-runtime:browser-executable-missing:chromium',
      package: 'verification-runtime:package-load-failed:ajv'
    };
    assert.equal(blockerIds(result).includes(expected[defect]), true);
  }
});

test('doctor reports permission and receipt identity failures as exact blockers', (t) => {
  const fixture = runtimeFixture(t);
  const receiptFile = path.join(fixture.runtimeRoot, 'install-receipt.json');
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  receipt.kernel.contract_digest = '0'.repeat(64);
  writeJson(receiptFile, receipt);
  const adapters = {
    ...fixture.adapters,
    accessPath({ kind }) {
      return kind !== 'runtime-root';
    }
  };

  const result = doctorRuntime({
    requestedVersion: fixture.lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    runtimeBase: fixture.runtimeBase,
    lock: fixture.lock,
    adapters
  });

  assert.equal(
    blockerIds(result).includes('verification-runtime:runtime-permission-denied'),
    true
  );
  assert.equal(
    blockerIds(result).includes('verification-runtime:receipt-kernel-mismatch'),
    true
  );
});

test('doctor returns the explicit runtime repair command for installed-runtime corruption', (t) => {
  const fixture = runtimeFixture(t);
  const receiptFile = path.join(fixture.runtimeRoot, 'install-receipt.json');
  fs.writeFileSync(receiptFile, '{ invalid json');
  const repairCommand = 'node verification-runtime.js repair --version 2.0.0-alpha.1';

  const result = doctorRuntime({
    requestedVersion: fixture.lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    runtimeBase: fixture.runtimeBase,
    lock: fixture.lock,
    repairCommand,
    adapters: fixture.adapters
  });

  assert.equal(result.ok, false);
  assert.equal(
    blockerIds(result).includes('verification-runtime:receipt-corrupt'),
    true
  );
  assert.deepEqual(result.actions, [{
    id: 'verification-runtime:repair-required',
    command: repairCommand
  }]);
});

test('explicit repair preserves the prior runtime and restores it if replacement fails', async (t) => {
  const fixture = runtimeFixture(t);
  const marker = path.join(fixture.runtimeRoot, 'prior-runtime-marker');
  fs.writeFileSync(marker, 'prior');

  const repaired = await repairRuntime({
    requestedVersion: fixture.lock.runtime_version,
    environment: environment(),
    projectRoot: ROOT,
    runtimeBase: fixture.runtimeBase,
    lock: fixture.lock,
    now: new Date('2026-07-31T06:30:00.000Z'),
    async install(options) {
      const target = path.join(options.runtimeBase, fixture.lock.runtime_version);
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'replacement-marker'), 'replacement');
      return { ok: true, status: 'installed', runtimeRoot: target };
    }
  });
  assert.equal(repaired.status, 'repaired');
  assert.equal(fs.existsSync(path.join(repaired.previousRuntimeRoot, 'prior-runtime-marker')), true);
  assert.equal(fs.existsSync(path.join(repaired.runtimeRoot, 'replacement-marker')), true);

  fs.rmSync(repaired.runtimeRoot, { recursive: true, force: true });
  fs.renameSync(repaired.previousRuntimeRoot, repaired.runtimeRoot);
  await assert.rejects(
    repairRuntime({
      requestedVersion: fixture.lock.runtime_version,
      environment: environment(),
      projectRoot: ROOT,
      runtimeBase: fixture.runtimeBase,
      lock: fixture.lock,
      now: new Date('2026-07-31T06:31:00.000Z'),
      async install() {
        throw new Error('fixture-replacement-failed');
      }
    }),
    /fixture-replacement-failed/
  );
  assert.equal(fs.readFileSync(marker, 'utf8'), 'prior');
});
