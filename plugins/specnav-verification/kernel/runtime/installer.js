'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveRuntimeLock } = require('./lock-manifest');
const {
  moduleTreeDigest
} = require('./runtime-integrity');

const PROJECT_MANIFESTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock'
]);

class RuntimeInstallError extends Error {
  constructor(blocker, details = {}) {
    super(blocker);
    this.name = 'RuntimeInstallError';
    this.blocker = blocker;
    this.artifact = details.artifact || null;
    this.attemptLog = details.attemptLog || null;
    this.exitStatus = details.exitStatus ?? null;
  }
}

function runtimeBaseDefault() {
  return path.join(os.homedir(), '.specnav', 'runtime', 'verification');
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function stableToken(now = new Date()) {
  return now.toISOString().replace(/[-:.TZ]/g, '');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function snapshotProjectManifests(projectRoot) {
  return PROJECT_MANIFESTS
    .map((name) => {
      const file = path.join(projectRoot, name);
      if (!fs.existsSync(file)) return null;
      return {
        path: name,
        sha256: sha256File(file)
      };
    })
    .filter(Boolean);
}

function compareProjectManifests(projectRoot, before) {
  const previous = new Map(before.map((entry) => [entry.path, entry.sha256]));
  const current = new Map(
    snapshotProjectManifests(projectRoot).map((entry) => [entry.path, entry.sha256])
  );
  return [...new Set([...previous.keys(), ...current.keys()])]
    .sort()
    .map((manifestPath) => {
      const beforeSha = previous.get(manifestPath) || null;
      const afterSha = current.get(manifestPath) || null;
      return {
        path: manifestPath,
        before_sha256: beforeSha,
        after_sha256: afterSha,
        unchanged: beforeSha !== null && afterSha === beforeSha
      };
    });
}

function browserDirectoryName(browser) {
  return `${browser.name.replace(/-/g, '_')}-${browser.revision}`;
}

function browserExecutableRelativePath(browser, platformKey) {
  if (platformKey !== 'darwin-arm64') {
    throw new Error(`verification-runtime:unsupported-browser-layout:${platformKey}`);
  }
  if (browser.name === 'chromium') {
    return path.join(
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing'
    );
  }
  if (browser.name === 'chromium-headless-shell') {
    return path.join(
      'chrome-headless-shell-mac-arm64',
      'chrome-headless-shell'
    );
  }
  if (browser.name === 'ffmpeg') {
    return 'ffmpeg-mac';
  }
  throw new Error(`verification-runtime:unsupported-browser:${browser.name}`);
}

function defaultInstallPackages(request) {
  const args = [
    'install',
    '--package-lock=true',
    '--save-exact',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefix',
    request.stagingRoot,
    ...request.packageSpecs
  ];
  const run = spawnSync('npm', args, {
    cwd: request.stagingRoot,
    env: { ...process.env, ...request.environment },
    encoding: 'utf8',
    timeout: 15 * 60 * 1000
  });
  return {
    command: 'npm',
    args,
    status: run.status === null ? 1 : run.status,
    stdout: run.stdout || '',
    stderr: run.stderr || run.error?.message || ''
  };
}

async function defaultDownloadFile({ url, destination }) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const args = [
    '--fail',
    '--location',
    '--retry',
    '2',
    '--output',
    destination,
    url
  ];
  const run = spawnSync(
    '/usr/bin/curl',
    args,
    {
      encoding: 'utf8',
      timeout: 15 * 60 * 1000
    }
  );
  return {
    command: '/usr/bin/curl',
    args,
    status: run.status === null ? 1 : run.status,
    stdout: run.stdout || '',
    stderr: run.stderr || run.error?.message || ''
  };
}

function defaultExtractArchive({ archive, destination }) {
  fs.mkdirSync(destination, { recursive: true });
  const args = ['-x', '-k', archive, destination];
  const run = spawnSync('/usr/bin/ditto', args, {
    encoding: 'utf8',
    timeout: 5 * 60 * 1000
  });
  return {
    command: '/usr/bin/ditto',
    args,
    status: run.status === null ? 1 : run.status,
    stdout: run.stdout || '',
    stderr: run.stderr || run.error?.message || ''
  };
}

async function runAdapter(adapter, request, fallbackCommand) {
  try {
    const result = await adapter(request);
    return {
      command: result?.command || fallbackCommand,
      args: Array.isArray(result?.args) ? result.args : [],
      status: Number.isInteger(result?.status) ? result.status : 0,
      stdout: typeof result?.stdout === 'string' ? result.stdout : '',
      stderr: typeof result?.stderr === 'string' ? result.stderr : ''
    };
  } catch (error) {
    return {
      command: fallbackCommand,
      args: [],
      status: 1,
      stdout: '',
      stderr: error instanceof Error ? error.stack || error.message : String(error)
    };
  }
}

function writeAttempt(stagingRoot, name, value) {
  const relative = path.posix.join('attempts', `${name}.json`);
  writeJson(path.join(stagingRoot, ...relative.split('/')), {
    schema: 'specnav.verification.runtime-install-attempt.v1',
    ...value
  });
  return relative;
}

function verifyPackages(stagingRoot, lock) {
  const lockFile = path.join(stagingRoot, 'package-lock.json');
  if (!fs.existsSync(lockFile)) {
    throw new Error('verification-runtime:missing-package-lock');
  }
  const installedLock = readJson(lockFile);
  if (installedLock.lockfileVersion !== lock.package_manager.lockfile_version) {
    throw new Error(
      `verification-runtime:package-lock-version-mismatch:${installedLock.lockfileVersion}`
    );
  }

  const receipts = [];
  for (const [name, expected] of Object.entries(lock.packages)) {
    const packageFile = path.join(stagingRoot, 'node_modules', ...name.split('/'), 'package.json');
    if (!fs.existsSync(packageFile)) {
      throw new Error(`verification-runtime:missing-package:${name}`);
    }
    const installed = readJson(packageFile);
    if (installed.version !== expected.version) {
      throw new Error(
        `verification-runtime:package-version-mismatch:${name}:${installed.version}`
      );
    }
    const packageLockEntry = installedLock.packages?.[`node_modules/${name}`];
    if (!packageLockEntry || packageLockEntry.integrity !== expected.integrity) {
      throw new Error(`verification-runtime:package-integrity-mismatch:${name}`);
    }
    receipts.push({
      name,
      version: installed.version,
      integrity: packageLockEntry.integrity,
      integrity_verified: true
    });
  }
  return {
    packages: receipts,
    packageLockSha256: sha256File(lockFile)
  };
}

async function installBrowsers(stagingRoot, lock, platformKey, adapters, emit) {
  const downloadsRoot = path.join(stagingRoot, '.downloads');
  const browsersRoot = path.join(stagingRoot, 'browsers');
  const receipts = [];
  fs.mkdirSync(downloadsRoot, { recursive: true });
  fs.mkdirSync(browsersRoot, { recursive: true });

  for (const browser of lock.browsers.filter((item) => item.install_by_default)) {
    const artifact = browser.artifacts?.[platformKey];
    if (!artifact) {
      throw new Error(
        `verification-runtime:missing-browser-artifact:${browser.name}:${platformKey}`
      );
    }
    const archive = path.join(downloadsRoot, `${browser.name}-${browser.revision}.zip`);
    emit('browser-download-started', {
      browser: browser.name,
      revision: browser.revision,
      size_bytes: artifact.size_bytes
    });
    const downloadRun = await runAdapter(adapters.downloadFile, {
      browser,
      artifact,
      url: artifact.url,
      destination: archive
    }, '/usr/bin/curl');
    const downloadAttempt = writeAttempt(
      stagingRoot,
      `browser-download-${browser.name}`,
      {
        operation: 'browser-download',
        browser: browser.name,
        revision: browser.revision,
        artifact: path.relative(stagingRoot, archive),
        url: artifact.url,
        command: downloadRun.command,
        args: downloadRun.args,
        exit_status: downloadRun.status,
        stdout: downloadRun.stdout,
        stderr: downloadRun.stderr
      }
    );
    if (downloadRun.status !== 0) {
      throw new RuntimeInstallError(
        `verification-runtime:browser-download-failed:${browser.name}`,
        {
          artifact: path.relative(stagingRoot, archive),
          attemptLog: downloadAttempt,
          exitStatus: downloadRun.status
        }
      );
    }
    const size = fs.statSync(archive).size;
    const digest = sha256File(archive);
    if (size !== artifact.size_bytes || digest !== artifact.sha256) {
      throw new RuntimeInstallError(
        `verification-runtime:browser-integrity-mismatch:${browser.name}`,
        {
          artifact: path.relative(stagingRoot, archive),
          attemptLog: downloadAttempt
        }
      );
    }
    emit('browser-download-verified', {
      browser: browser.name,
      revision: browser.revision,
      size_bytes: size,
      sha256: digest
    });

    const directoryName = browserDirectoryName(browser);
    const browserRoot = path.join(browsersRoot, directoryName);
    emit('browser-extract-started', {
      browser: browser.name,
      revision: browser.revision
    });
    const extractRun = await runAdapter(adapters.extractArchive, {
      browser,
      artifact,
      archive,
      destination: browserRoot
    }, '/usr/bin/ditto');
    const extractAttempt = writeAttempt(
      stagingRoot,
      `browser-extract-${browser.name}`,
      {
        operation: 'browser-extract',
        browser: browser.name,
        revision: browser.revision,
        artifact: path.relative(stagingRoot, browserRoot),
        command: extractRun.command,
        args: extractRun.args,
        exit_status: extractRun.status,
        stdout: extractRun.stdout,
        stderr: extractRun.stderr
      }
    );
    if (extractRun.status !== 0) {
      throw new RuntimeInstallError(
        `verification-runtime:browser-extract-failed:${browser.name}`,
        {
          artifact: path.relative(stagingRoot, browserRoot),
          attemptLog: extractAttempt,
          exitStatus: extractRun.status
        }
      );
    }
    const executableRelativePath = browserExecutableRelativePath(browser, platformKey);
    const executable = path.join(browserRoot, executableRelativePath);
    if (!fs.existsSync(executable)) {
      throw new RuntimeInstallError(
        `verification-runtime:missing-browser-executable:${browser.name}`,
        {
          artifact: path.relative(stagingRoot, executable),
          attemptLog: extractAttempt
        }
      );
    }
    fs.chmodSync(executable, 0o755);
    fs.writeFileSync(path.join(browserRoot, 'INSTALLATION_COMPLETE'), '');
    emit('browser-ready', {
      browser: browser.name,
      revision: browser.revision
    });
    receipts.push({
      name: browser.name,
      revision: browser.revision,
      browser_version: browser.browser_version,
      url: artifact.url,
      sha256: digest,
      size_bytes: size,
      directory: path.posix.join('browsers', directoryName),
      executable: path.posix.join(
        'browsers',
        directoryName,
        ...executableRelativePath.split(path.sep)
      ),
      executable_sha256: sha256File(executable),
      integrity_verified: true
    });
  }

  fs.rmSync(downloadsRoot, { recursive: true, force: true });
  return receipts;
}

function packageManifest(lock) {
  return {
    name: 'specnav-verification-runtime',
    version: lock.runtime_version,
    private: true,
    description: 'Managed SpecNav Verification Runtime. Do not edit.',
    dependencies: Object.fromEntries(
      Object.entries(lock.packages).map(([name, spec]) => [name, spec.version])
    )
  };
}

function failureDirectory(runtimeBase, runtimeVersion, now) {
  const prefix = `.${runtimeVersion}.failed-${stableToken(now)}-${process.pid}`;
  let candidate = path.join(runtimeBase, prefix);
  let sequence = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(runtimeBase, `${prefix}-${sequence}`);
    sequence += 1;
  }
  return candidate;
}

async function installRuntime(options) {
  const {
    requestedVersion,
    environment,
    projectRoot = process.cwd(),
    runtimeBase = runtimeBaseDefault(),
    lock,
    adapters: injectedAdapters = {},
    onEvent = () => {}
  } = options || {};
  const emit = (event, detail = {}) => onEvent({
    schema: 'specnav.verification.runtime-install-event.v1',
    event,
    runtime_version: requestedVersion || null,
    recorded_at: new Date().toISOString(),
    ...detail
  });
  const resolved = resolveRuntimeLock(requestedVersion, environment, lock);
  if (!resolved.ok) {
    throw new Error(resolved.blockers.join(','));
  }

  const runtimeLock = resolved.lock;
  fs.mkdirSync(runtimeBase, { recursive: true });
  const managedRuntimeBase = fs.realpathSync(runtimeBase);
  const targetRoot = path.join(managedRuntimeBase, runtimeLock.runtime_version);
  if (fs.existsSync(targetRoot)) {
    throw new Error(`verification-runtime:target-exists:${runtimeLock.runtime_version}`);
  }

  const now = injectedAdapters.now ? injectedAdapters.now() : new Date();
  const stagingRoot = path.join(
    managedRuntimeBase,
    `.${runtimeLock.runtime_version}.installing-${stableToken(now)}-${process.pid}-${crypto.randomUUID()}`
  );
  fs.mkdirSync(stagingRoot);

  const adapters = {
    installPackages: injectedAdapters.installPackages || defaultInstallPackages,
    downloadFile: injectedAdapters.downloadFile || defaultDownloadFile,
    extractArchive: injectedAdapters.extractArchive || defaultExtractArchive
  };
  const projectBefore = snapshotProjectManifests(projectRoot);

  try {
    emit('install-started', {
      staging_root: stagingRoot,
      target_root: targetRoot
    });
    writeJson(path.join(stagingRoot, 'package.json'), packageManifest(runtimeLock));
    const platformKey = `${environment.platform}-${environment.arch}`;
    const packageEnvironment = {
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      PLAYWRIGHT_BROWSERS_PATH: path.join(stagingRoot, 'browsers'),
      npm_config_cache: path.join(stagingRoot, '.npm-cache')
    };
    const packageSpecs = Object.entries(runtimeLock.packages)
      .map(([name, spec]) => `${name}@${spec.version}`);
    emit('package-install-started', {
      packages: packageSpecs
    });
    const packageRun = await runAdapter(adapters.installPackages, {
      stagingRoot,
      packageSpecs,
      environment: packageEnvironment
    }, 'npm');
    const packageAttempt = writeAttempt(stagingRoot, 'package-install', {
      operation: 'package-install',
      artifact: 'package-lock.json',
      command: packageRun.command,
      args: packageRun.args,
      exit_status: packageRun.status,
      stdout: packageRun.stdout,
      stderr: packageRun.stderr,
      stdout_sha256: sha256Buffer(packageRun.stdout),
      stderr_sha256: sha256Buffer(packageRun.stderr)
    });
    if (packageRun.status !== 0) {
      throw new RuntimeInstallError(
        'verification-runtime:package-install-failed',
        {
          artifact: 'package-lock.json',
          attemptLog: packageAttempt,
          exitStatus: packageRun.status
        }
      );
    }

    let packageResult;
    try {
      packageResult = verifyPackages(stagingRoot, runtimeLock);
    } catch (error) {
      throw new RuntimeInstallError(
        error instanceof Error ? error.message : String(error),
        {
          artifact: 'package-lock.json',
          attemptLog: packageAttempt
        }
      );
    }
    emit('package-install-verified', {
      package_count: packageResult.packages.length,
      package_lock_sha256: packageResult.packageLockSha256
    });
    const browsers = await installBrowsers(
      stagingRoot,
      runtimeLock,
      platformKey,
      adapters,
      emit
    );
    fs.rmSync(path.join(stagingRoot, '.npm-cache'), { recursive: true, force: true });

    const projectManifests = compareProjectManifests(projectRoot, projectBefore);
    if (projectManifests.some((manifest) => !manifest.unchanged)) {
      throw new Error('verification-runtime:business-manifest-mutated');
    }

    const receipt = {
      schema: 'specnav.verification.runtime-install-receipt.v1',
      status: 'installed',
      runtime_version: runtimeLock.runtime_version,
      installed_at: now.toISOString(),
      platform: platformKey,
      node_version: environment.nodeVersion,
      kernel: {
        name: runtimeLock.kernel.name,
        version: runtimeLock.kernel.version,
        api_version: runtimeLock.kernel.api_version,
        contract_version: runtimeLock.kernel.contract_version,
        contract_digest: runtimeLock.kernel.contract_digest
      },
      package_lock_sha256: packageResult.packageLockSha256,
      module_tree_sha256: moduleTreeDigest(stagingRoot),
      packages: packageResult.packages,
      browsers,
      project_root: path.resolve(projectRoot),
      project_manifests: projectManifests,
      fallback_used: false
    };
    writeJson(path.join(stagingRoot, 'install-receipt.json'), receipt);
    fs.renameSync(stagingRoot, targetRoot);
    emit('install-completed', {
      runtime_root: targetRoot,
      package_count: receipt.packages.length,
      browser_count: receipt.browsers.length
    });
    return {
      ok: true,
      status: 'installed',
      runtimeRoot: targetRoot,
      receipt: { ...receipt, runtime_root: targetRoot }
    };
  } catch (error) {
    const blocker = error instanceof RuntimeInstallError
      ? error.blocker
      : error instanceof Error
        ? error.message
        : String(error);
    const failedRoot = failureDirectory(managedRuntimeBase, runtimeLock.runtime_version, now);
    writeJson(path.join(stagingRoot, 'failure-receipt.json'), {
      schema: 'specnav.verification.runtime-install-failure.v1',
      status: 'failed',
      runtime_version: runtimeLock.runtime_version,
      failed_at: new Date().toISOString(),
      blocker,
      artifact: error instanceof RuntimeInstallError ? error.artifact : null,
      attempt_log: error instanceof RuntimeInstallError ? error.attemptLog : null,
      exit_status: error instanceof RuntimeInstallError ? error.exitStatus : null,
      fallback_used: false
    });
    fs.renameSync(stagingRoot, failedRoot);
    emit('install-failed', {
      blocker,
      failed_root: failedRoot
    });
    throw error;
  }
}

module.exports = {
  PROJECT_MANIFESTS,
  RuntimeInstallError,
  browserDirectoryName,
  browserExecutableRelativePath,
  compareProjectManifests,
  installRuntime,
  runtimeBaseDefault,
  sha256File,
  snapshotProjectManifests,
  verifyPackages
};
