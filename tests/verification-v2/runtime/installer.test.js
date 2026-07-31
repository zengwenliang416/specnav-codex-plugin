'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  browserExecutableRelativePath,
  installRuntime
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/installer'
));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

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

function fixtureLock() {
  const lock = JSON.parse(JSON.stringify(loadRuntimeLock()));
  for (const browser of lock.browsers) {
    const bytes = Buffer.from(`fixture archive for ${browser.name}`);
    const artifact = browser.artifacts['darwin-arm64'];
    artifact.url = `https://fixtures.invalid/${browser.name}.zip`;
    artifact.sha256 = sha256(bytes);
    artifact.size_bytes = bytes.length;
  }
  return lock;
}

function packageLock(lock) {
  const packages = {
    '': {
      name: 'specnav-verification-runtime',
      version: lock.runtime_version,
      private: true
    }
  };
  for (const [name, spec] of Object.entries(lock.packages)) {
    packages[`node_modules/${name}`] = {
      version: spec.version,
      integrity: spec.integrity
    };
  }
  return {
    name: 'specnav-verification-runtime',
    version: lock.runtime_version,
    lockfileVersion: 3,
    requires: true,
    packages
  };
}

function successfulAdapters(lock, calls) {
  return {
    async installPackages(request) {
      calls.packageInstall = request;
      fs.writeFileSync(
        path.join(request.stagingRoot, 'package-lock.json'),
        `${JSON.stringify(packageLock(lock), null, 2)}\n`
      );
      for (const [name, spec] of Object.entries(lock.packages)) {
        const packageRoot = path.join(request.stagingRoot, 'node_modules', ...name.split('/'));
        fs.mkdirSync(packageRoot, { recursive: true });
        fs.writeFileSync(
          path.join(packageRoot, 'package.json'),
          `${JSON.stringify({ name, version: spec.version })}\n`
        );
      }
      return {
        command: 'fixture-npm',
        args: request.packageSpecs,
        status: 0,
        stdout: 'installed',
        stderr: ''
      };
    },
    async downloadFile({ browser, destination }) {
      calls.downloads.push(browser.name);
      fs.writeFileSync(destination, Buffer.from(`fixture archive for ${browser.name}`));
      return {
        command: 'fixture-download',
        args: [browser.name],
        status: 0,
        stdout: 'downloaded',
        stderr: ''
      };
    },
    async extractArchive({ browser, destination }) {
      calls.extractions.push(browser.name);
      const executable = path.join(
        destination,
        browserExecutableRelativePath(browser, 'darwin-arm64')
      );
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n');
      return {
        command: 'fixture-extract',
        args: [browser.name],
        status: 0,
        stdout: 'extracted',
        stderr: ''
      };
    }
  };
}

test('installer writes a complete side-by-side runtime and leaves the project unchanged', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-install-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const projectRoot = path.join(sandbox, 'business-project');
  const runtimeBase = path.join(sandbox, 'managed', 'verification');
  fs.mkdirSync(projectRoot, { recursive: true });
  const projectPackage = '{"name":"business-project","private":true}\n';
  const projectLock = '{"lockfileVersion":3}\n';
  fs.writeFileSync(path.join(projectRoot, 'package.json'), projectPackage);
  fs.writeFileSync(path.join(projectRoot, 'package-lock.json'), projectLock);

  const lock = fixtureLock();
  const calls = { packageInstall: null, downloads: [], extractions: [] };
  const events = [];
  const result = await installRuntime({
    requestedVersion: lock.runtime_version,
    environment: environment(),
    projectRoot,
    runtimeBase,
    lock,
    adapters: successfulAdapters(lock, calls),
    onEvent(event) {
      events.push(event.event);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'installed');
  assert.equal(
    result.runtimeRoot,
    path.join(fs.realpathSync(runtimeBase), lock.runtime_version)
  );
  assert.equal(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'), projectPackage);
  assert.equal(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'), projectLock);

  assert.deepEqual(calls.downloads, ['chromium', 'chromium-headless-shell']);
  assert.deepEqual(calls.extractions, ['chromium', 'chromium-headless-shell']);
  assert.deepEqual(events, [
    'install-started',
    'package-install-started',
    'package-install-verified',
    'browser-download-started',
    'browser-download-verified',
    'browser-extract-started',
    'browser-ready',
    'browser-download-started',
    'browser-download-verified',
    'browser-extract-started',
    'browser-ready',
    'install-completed'
  ]);
  assert.deepEqual(
    calls.packageInstall.packageSpecs,
    Object.entries(lock.packages).map(([name, spec]) => `${name}@${spec.version}`)
  );
  assert.equal(calls.packageInstall.environment.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
  assert.equal(
    calls.packageInstall.environment.PLAYWRIGHT_BROWSERS_PATH,
    path.join(calls.packageInstall.stagingRoot, 'browsers')
  );

  const receipt = JSON.parse(fs.readFileSync(
    path.join(result.runtimeRoot, 'install-receipt.json'),
    'utf8'
  ));
  assert.equal(receipt.schema, 'specnav.verification.runtime-install-receipt.v1');
  assert.equal(receipt.status, 'installed');
  assert.equal(receipt.runtime_version, lock.runtime_version);
  assert.equal(receipt.kernel.contract_digest, metadata.contractDigest);
  assert.equal(receipt.packages.length, Object.keys(lock.packages).length);
  assert.equal(receipt.browsers.length, 2);
  assert.ok(receipt.browsers.every((browser) => browser.integrity_verified === true));
  assert.ok(receipt.project_manifests.every((manifest) => manifest.unchanged === true));

  for (const browser of lock.browsers) {
    const directoryName = browser.name.replace(/-/g, '_') + `-${browser.revision}`;
    const browserRoot = path.join(result.runtimeRoot, 'browsers', directoryName);
    assert.equal(fs.existsSync(path.join(browserRoot, 'INSTALLATION_COMPLETE')), true);
    assert.equal(
      fs.existsSync(path.join(
        browserRoot,
        browserExecutableRelativePath(browser, 'darwin-arm64')
      )),
      true
    );
  }
});

test('installer preserves a failed attempt and never promotes invalid browser bytes', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-failure-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const lock = fixtureLock();
  const calls = { packageInstall: null, downloads: [], extractions: [] };
  const adapters = successfulAdapters(lock, calls);
  adapters.downloadFile = async ({ destination }) => {
    fs.writeFileSync(destination, 'tampered browser archive');
    return {
      command: 'fixture-download',
      args: [destination],
      status: 0,
      stdout: 'downloaded tampered bytes',
      stderr: ''
    };
  };

  await assert.rejects(
    installRuntime({
      requestedVersion: lock.runtime_version,
      environment: environment(),
      projectRoot: sandbox,
      runtimeBase: path.join(sandbox, 'managed', 'verification'),
      lock,
      adapters
    }),
    /verification-runtime:browser-integrity-mismatch:chromium/
  );

  const runtimeBase = path.join(sandbox, 'managed', 'verification');
  const names = fs.readdirSync(runtimeBase);
  assert.equal(names.includes(lock.runtime_version), false);
  const failed = names.filter((name) => name.startsWith(`.${lock.runtime_version}.failed-`));
  assert.equal(failed.length, 1);
  const failureReceipt = JSON.parse(fs.readFileSync(
    path.join(runtimeBase, failed[0], 'failure-receipt.json'),
    'utf8'
  ));
  assert.equal(failureReceipt.status, 'failed');
  assert.equal(failureReceipt.artifact, '.downloads/chromium-1234.zip');
  assert.equal(failureReceipt.attempt_log, 'attempts/browser-download-chromium.json');
  assert.match(
    failureReceipt.blocker,
    /verification-runtime:browser-integrity-mismatch:chromium/
  );
});

test('installer refuses an occupied runtime root instead of overwriting it', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-occupied-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const lock = fixtureLock();
  const runtimeBase = path.join(sandbox, 'managed', 'verification');
  fs.mkdirSync(path.join(runtimeBase, lock.runtime_version), { recursive: true });

  await assert.rejects(
    installRuntime({
      requestedVersion: lock.runtime_version,
      environment: environment(),
      projectRoot: sandbox,
      runtimeBase,
      lock,
      adapters: successfulAdapters(lock, {
        packageInstall: null,
        downloads: [],
        extractions: []
      })
    }),
    /verification-runtime:target-exists:2\.0\.0-alpha\.1/
  );
});

test('installer blocks when a new business-project lockfile appears', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-project-drift-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const projectRoot = path.join(sandbox, 'business-project');
  const runtimeBase = path.join(sandbox, 'managed', 'verification');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"business"}\n');

  const lock = fixtureLock();
  const calls = { packageInstall: null, downloads: [], extractions: [] };
  const adapters = successfulAdapters(lock, calls);
  const installPackages = adapters.installPackages;
  adapters.installPackages = async (request) => {
    const result = await installPackages(request);
    fs.writeFileSync(path.join(projectRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    return result;
  };

  await assert.rejects(
    installRuntime({
      requestedVersion: lock.runtime_version,
      environment: environment(),
      projectRoot,
      runtimeBase,
      lock,
      adapters
    }),
    /verification-runtime:business-manifest-mutated/
  );

  assert.equal(fs.existsSync(path.join(runtimeBase, lock.runtime_version)), false);
  const failed = fs.readdirSync(runtimeBase)
    .filter((name) => name.startsWith(`.${lock.runtime_version}.failed-`));
  assert.equal(failed.length, 1);
});

test('installer preserves package-manager failure output and affected artifact', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-npm-failure-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const lock = fixtureLock();
  const adapters = successfulAdapters(lock, {
    packageInstall: null,
    downloads: [],
    extractions: []
  });
  adapters.installPackages = async () => ({
    command: 'npm',
    args: ['install'],
    status: 42,
    stdout: 'partial install output',
    stderr: 'registry unavailable'
  });
  const runtimeBase = path.join(sandbox, 'managed', 'verification');

  await assert.rejects(
    installRuntime({
      requestedVersion: lock.runtime_version,
      environment: environment(),
      projectRoot: sandbox,
      runtimeBase,
      lock,
      adapters
    }),
    /verification-runtime:package-install-failed/
  );

  const failedRoot = path.join(
    runtimeBase,
    fs.readdirSync(runtimeBase).find((name) => name.includes('.failed-'))
  );
  const receipt = JSON.parse(fs.readFileSync(
    path.join(failedRoot, 'failure-receipt.json'),
    'utf8'
  ));
  assert.equal(receipt.artifact, 'package-lock.json');
  assert.equal(receipt.attempt_log, 'attempts/package-install.json');
  assert.equal(receipt.exit_status, 42);
  const attempt = JSON.parse(fs.readFileSync(
    path.join(failedRoot, receipt.attempt_log),
    'utf8'
  ));
  assert.equal(attempt.command, 'npm');
  assert.deepEqual(attempt.args, ['install']);
  assert.equal(attempt.stdout, 'partial install output');
  assert.equal(attempt.stderr, 'registry unavailable');
});

test('installer preserves download and extraction command failures', async (t) => {
  for (const failure of ['download', 'extract']) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `specnav-runtime-${failure}-failure-`));
    t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
    const lock = fixtureLock();
    const adapters = successfulAdapters(lock, {
      packageInstall: null,
      downloads: [],
      extractions: []
    });
    if (failure === 'download') {
      adapters.downloadFile = async () => ({
        command: '/usr/bin/curl',
        args: ['--fail', 'fixture-url'],
        status: 22,
        stdout: '',
        stderr: '404 fixture'
      });
    } else {
      adapters.extractArchive = async () => ({
        command: '/usr/bin/ditto',
        args: ['-x', '-k', 'fixture.zip', 'fixture-dir'],
        status: 1,
        stdout: '',
        stderr: 'invalid zip'
      });
    }
    const runtimeBase = path.join(sandbox, 'managed', 'verification');

    await assert.rejects(
      installRuntime({
        requestedVersion: lock.runtime_version,
        environment: environment(),
        projectRoot: sandbox,
        runtimeBase,
        lock,
        adapters
      }),
      new RegExp(`verification-runtime:browser-${failure}-failed:chromium`)
    );

    const failedRoot = path.join(
      runtimeBase,
      fs.readdirSync(runtimeBase).find((name) => name.includes('.failed-'))
    );
    const receipt = JSON.parse(fs.readFileSync(
      path.join(failedRoot, 'failure-receipt.json'),
      'utf8'
    ));
    assert.equal(receipt.exit_status, failure === 'download' ? 22 : 1);
    assert.match(receipt.artifact, failure === 'download' ? /\.downloads/ : /browsers/);
    const attempt = JSON.parse(fs.readFileSync(
      path.join(failedRoot, receipt.attempt_log),
      'utf8'
    ));
    assert.match(attempt.stderr, failure === 'download' ? /404/ : /invalid zip/);
  }
});

test('installer canonicalizes a symlinked runtime base before invoking npm', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-realpath-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const realBase = path.join(sandbox, 'real-runtime');
  const linkedBase = path.join(sandbox, 'linked-runtime');
  fs.mkdirSync(realBase);
  fs.symlinkSync(realBase, linkedBase);

  const lock = fixtureLock();
  const calls = { packageInstall: null, downloads: [], extractions: [] };
  const result = await installRuntime({
    requestedVersion: lock.runtime_version,
    environment: environment(),
    projectRoot: sandbox,
    runtimeBase: linkedBase,
    lock,
    adapters: successfulAdapters(lock, calls)
  });

  assert.equal(
    calls.packageInstall.stagingRoot.startsWith(`${fs.realpathSync(realBase)}${path.sep}`),
    true
  );
  assert.equal(
    result.runtimeRoot,
    path.join(fs.realpathSync(realBase), lock.runtime_version)
  );
});
