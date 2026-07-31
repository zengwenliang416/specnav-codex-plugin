'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const { resolveRuntimeLock } = require('./lock-manifest');
const {
  browserDirectoryName,
  browserExecutableRelativePath,
  runtimeBaseDefault,
  sha256File
} = require('./installer');
const {
  probeProvider
} = require('./provider-contract');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function blocker(id, artifact = null, detail = null) {
  return { id, artifact, detail };
}

function warning(id, artifact = null, detail = null) {
  return { id, artifact, detail };
}

function addUnique(items, item) {
  if (!items.some((entry) => (
    entry.id === item.id
    && entry.artifact === item.artifact
    && entry.detail === item.detail
  ))) {
    items.push(item);
  }
}

function addAction(actions, id, command) {
  if (!command) return;
  if (!actions.some((entry) => entry.id === id && entry.command === command)) {
    actions.push({ id, command });
  }
}

function blockedResult({
  requestedVersion = null,
  runtimeRoot = null,
  checks,
  blockers,
  warnings,
  actions
}) {
  return {
    schema: 'specnav.verification.runtime-status.v1',
    ok: false,
    readiness: 'blocked',
    runtime_version: requestedVersion,
    runtime_root: runtimeRoot,
    checks,
    blockers,
    warnings,
    actions,
    fallback_used: false
  };
}

function defaultAccessPath({ file, kind }) {
  let mode = fs.constants.R_OK;
  if (kind === 'runtime-root' || kind === 'runtime-base') {
    mode |= fs.constants.X_OK;
  }
  if (kind === 'runtime-base') {
    mode |= fs.constants.W_OK;
  }
  if (kind === 'browser-executable') {
    mode |= fs.constants.X_OK;
  }
  try {
    fs.accessSync(file, mode);
    return true;
  } catch {
    return false;
  }
}

function defaultLoadPackage({ runtimeRoot, name, expectedVersion }) {
  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(runtimeRoot, 'browsers');
    const packageFile = path.join(
      runtimeRoot,
      'node_modules',
      ...name.split('/'),
      'package.json'
    );
    const packageJson = readJson(packageFile);
    const runtimeRequire = createRequire(path.join(runtimeRoot, 'package.json'));
    runtimeRequire(name);
    return {
      ok: packageJson.version === expectedVersion,
      name,
      version: packageJson.version,
      error: packageJson.version === expectedVersion
        ? null
        : `version-mismatch:${packageJson.version}`
    };
  } catch (error) {
    return {
      ok: false,
      name,
      version: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (previousBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    }
  }
}

function defaultProbeBrowser({ browser, executable, spawn = spawnSync }) {
  const versionArgument = browser?.name === 'ffmpeg'
    ? '-version'
    : '--version';
  const run = spawn(executable, [versionArgument], {
    encoding: 'utf8',
    timeout: 20000
  });
  return {
    ok: run.status === 0,
    status: run.status === null ? 1 : run.status,
    stdout: run.stdout || '',
    stderr: run.stderr || run.error?.message || ''
  };
}

function safeRuntimePath(runtimeRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return null;
  const resolved = path.resolve(runtimeRoot, relativePath);
  const relative = path.relative(runtimeRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function sameKernelReceipt(receiptKernel, lockKernel) {
  return !!receiptKernel
    && receiptKernel.name === lockKernel.name
    && receiptKernel.version === lockKernel.version
    && receiptKernel.api_version === lockKernel.api_version
    && receiptKernel.contract_version === lockKernel.contract_version
    && receiptKernel.contract_digest === lockKernel.contract_digest;
}

function doctorRuntime(options = {}) {
  const {
    requestedVersion,
    environment = {},
    providerEnvironment = process.env,
    requiresMidscene = false,
    runtimeBase = runtimeBaseDefault(),
    lock,
    installCommand = `verification-runtime install --version ${requestedVersion || '<missing>'}`,
    repairCommand = null,
    pluginRepairCommand = null,
    environmentRepairCommand = null,
    adapters: injectedAdapters = {}
  } = options;
  const blockers = [];
  const warnings = [];
  const actions = [];
  const checks = {
    lock: { ok: false },
    runtime: { ok: false, root: null },
    receipt: { ok: false, path: null },
    permissions: [],
    packages: [],
    browsers: [],
    provider: probeProvider(providerEnvironment)
  };
  const adapters = {
    accessPath: injectedAdapters.accessPath || defaultAccessPath,
    loadPackage: injectedAdapters.loadPackage || defaultLoadPackage,
    probeBrowser: injectedAdapters.probeBrowser || defaultProbeBrowser
  };

  let resolved;
  try {
    resolved = resolveRuntimeLock(requestedVersion, environment, lock);
  } catch (error) {
    addUnique(blockers, blocker(
      'verification-runtime:lock-corrupt',
      'verification-runtime-lock.json',
      error instanceof Error ? error.message : String(error)
    ));
    addAction(
      actions,
      'verification-runtime:plugin-repair-required',
      pluginRepairCommand
    );
    return blockedResult({
      requestedVersion: requestedVersion || null,
      checks,
      blockers,
      warnings,
      actions
    });
  }
  if (!resolved.ok) {
    for (const id of resolved.blockers) addUnique(blockers, blocker(id));
    if (resolved.blockers.some((id) => id.startsWith('verification-runtime:unsupported-version:'))) {
      addAction(
        actions,
        'verification-runtime:install-supported-version',
        installCommand
      );
    }
    if (resolved.blockers.some((id) => (
      id.startsWith('verification-runtime:unsupported-node:')
      || id.startsWith('verification-runtime:unsupported-platform:')
    ))) {
      addAction(
        actions,
        'verification-runtime:environment-repair-required',
        environmentRepairCommand
      );
    }
    if (resolved.blockers.some((id) => (
      id.startsWith('verification-runtime:missing-kernel-identity')
      || id.startsWith('verification-runtime:kernel-')
    ))) {
      addAction(
        actions,
        'verification-runtime:plugin-repair-required',
        pluginRepairCommand
      );
    }
    return blockedResult({
      requestedVersion: requestedVersion || null,
      checks,
      blockers,
      warnings,
      actions
    });
  }
  const runtimeLock = resolved.lock;
  checks.lock = {
    ok: true,
    schema: runtimeLock.schema,
    runtime_version: runtimeLock.runtime_version
  };

  const basePath = fs.existsSync(runtimeBase)
    ? fs.realpathSync(runtimeBase)
    : path.resolve(runtimeBase);
  const runtimeRoot = path.join(basePath, runtimeLock.runtime_version);
  checks.runtime.root = runtimeRoot;
  if (!fs.existsSync(runtimeRoot)) {
    addUnique(blockers, blocker(
      'verification-runtime:runtime-missing',
      runtimeRoot
    ));
    addAction(
      actions,
      'verification-runtime:install-required',
      installCommand
    );
    return blockedResult({
      requestedVersion: runtimeLock.runtime_version,
      runtimeRoot,
      checks,
      blockers,
      warnings,
      actions
    });
  }
  checks.runtime.ok = true;

  for (const permissionCheck of [
    { kind: 'runtime-base', file: basePath },
    { kind: 'runtime-root', file: runtimeRoot }
  ]) {
    const ok = adapters.accessPath(permissionCheck);
    checks.permissions.push({ ...permissionCheck, ok });
    if (!ok) {
      addUnique(blockers, blocker(
        permissionCheck.kind === 'runtime-root'
          ? 'verification-runtime:runtime-permission-denied'
          : 'verification-runtime:runtime-base-permission-denied',
        permissionCheck.file
      ));
    }
  }

  const receiptFile = path.join(runtimeRoot, 'install-receipt.json');
  checks.receipt.path = receiptFile;
  let receipt = null;
  try {
    receipt = readJson(receiptFile);
  } catch (error) {
    addUnique(blockers, blocker(
      fs.existsSync(receiptFile)
        ? 'verification-runtime:receipt-corrupt'
        : 'verification-runtime:receipt-missing',
      receiptFile,
      error instanceof Error ? error.message : String(error)
    ));
  }
  if (receipt) {
    checks.receipt.ok = true;
    if (
      receipt.schema !== 'specnav.verification.runtime-install-receipt.v1'
      || receipt.status !== 'installed'
      || receipt.runtime_version !== runtimeLock.runtime_version
      || receipt.platform !== `${environment.platform}-${environment.arch}`
      || receipt.fallback_used !== false
    ) {
      checks.receipt.ok = false;
      addUnique(blockers, blocker(
        'verification-runtime:receipt-contract-mismatch',
        receiptFile
      ));
    }
    if (!sameKernelReceipt(receipt.kernel, runtimeLock.kernel)) {
      checks.receipt.ok = false;
      addUnique(blockers, blocker(
        'verification-runtime:receipt-kernel-mismatch',
        receiptFile
      ));
    }
  }

  const packageLockFile = path.join(runtimeRoot, 'package-lock.json');
  let packageLock = null;
  try {
    packageLock = readJson(packageLockFile);
  } catch (error) {
    addUnique(blockers, blocker(
      fs.existsSync(packageLockFile)
        ? 'verification-runtime:package-lock-corrupt'
        : 'verification-runtime:package-lock-missing',
      packageLockFile,
      error instanceof Error ? error.message : String(error)
    ));
  }
  if (
    packageLock
    && receipt
    && sha256File(packageLockFile) !== receipt.package_lock_sha256
  ) {
    addUnique(blockers, blocker(
      'verification-runtime:package-lock-integrity-mismatch',
      packageLockFile
    ));
  }

  for (const [name, expected] of Object.entries(runtimeLock.packages)) {
    const packageArtifact = path.join(
      runtimeRoot,
      'node_modules',
      ...name.split('/'),
      'package.json'
    );
    const lockEntry = packageLock?.packages?.[`node_modules/${name}`];
    const lockOk = !!lockEntry
      && lockEntry.version === expected.version
      && lockEntry.integrity === expected.integrity;
    if (!lockOk) {
      addUnique(blockers, blocker(
        `verification-runtime:package-lock-entry-mismatch:${name}`,
        packageLockFile
      ));
    }
    const loaded = adapters.loadPackage({
      runtimeRoot,
      name,
      expectedVersion: expected.version
    });
    const loadable = loaded?.ok === true && loaded.version === expected.version;
    checks.packages.push({
      name,
      expected_version: expected.version,
      installed_version: loaded?.version || null,
      lock_integrity_ok: lockOk,
      loadable,
      error: loadable ? null : loaded?.error || 'unknown-load-failure'
    });
    if (!loadable) {
      addUnique(blockers, blocker(
        `verification-runtime:package-load-failed:${name}`,
        packageArtifact,
        loaded?.error || null
      ));
    }
  }

  for (const browser of runtimeLock.browsers.filter((item) => item.install_by_default)) {
    const expectedDirectory = path.posix.join(
      'browsers',
      browserDirectoryName(browser)
    );
    const expectedExecutable = path.posix.join(
      expectedDirectory,
      ...browserExecutableRelativePath(
        browser,
        `${environment.platform}-${environment.arch}`
      ).split(path.sep)
    );
    const receiptBrowser = receipt?.browsers?.find((entry) => entry.name === browser.name);
    if (
      !receiptBrowser
      || receiptBrowser.revision !== browser.revision
      || receiptBrowser.directory !== expectedDirectory
      || receiptBrowser.executable !== expectedExecutable
      || receiptBrowser.sha256 !== browser.artifacts[
        `${environment.platform}-${environment.arch}`
      ]?.sha256
      || receiptBrowser.integrity_verified !== true
    ) {
      addUnique(blockers, blocker(
        `verification-runtime:browser-receipt-mismatch:${browser.name}`,
        receiptFile
      ));
    }
    const browserRoot = safeRuntimePath(runtimeRoot, expectedDirectory);
    const executable = safeRuntimePath(runtimeRoot, expectedExecutable);
    const marker = browserRoot
      ? path.join(browserRoot, 'INSTALLATION_COMPLETE')
      : null;
    const executableExists = !!executable && fs.existsSync(executable);
    const markerExists = !!marker && fs.existsSync(marker);
    const executableAllowed = executableExists && adapters.accessPath({
      kind: 'browser-executable',
      file: executable
    });
    let probe = { ok: false, status: null, stdout: '', stderr: '' };
    if (executableAllowed) {
      probe = adapters.probeBrowser({
        browser,
        executable,
        runtimeRoot
      }) || probe;
    }
    checks.browsers.push({
      name: browser.name,
      revision: browser.revision,
      marker_exists: markerExists,
      executable_exists: executableExists,
      executable_allowed: executableAllowed,
      probe_ok: probe.ok === true && probe.status === 0,
      probe_exit_status: probe.status
    });
    if (!markerExists) {
      addUnique(blockers, blocker(
        `verification-runtime:browser-marker-missing:${browser.name}`,
        marker
      ));
    }
    if (!executableExists) {
      addUnique(blockers, blocker(
        `verification-runtime:browser-executable-missing:${browser.name}`,
        executable
      ));
    } else if (!executableAllowed) {
      addUnique(blockers, blocker(
        `verification-runtime:browser-executable-permission-denied:${browser.name}`,
        executable
      ));
    } else if (!(probe.ok === true && probe.status === 0)) {
      addUnique(blockers, blocker(
        `verification-runtime:browser-probe-failed:${browser.name}`,
        executable,
        probe.stderr || probe.stdout || null
      ));
    }
  }

  if (!checks.provider.configured) {
    const providerStatus = blocker(
      'verification-runtime:midscene-provider-not-configured',
      'environment'
    );
    if (requiresMidscene) {
      addUnique(blockers, providerStatus);
    } else {
      addUnique(warnings, warning(
        providerStatus.id,
        providerStatus.artifact
      ));
    }
  }

  const runtimeBlocked = blockers.some((entry) => (
    entry.id !== 'verification-runtime:midscene-provider-not-configured'
  ));
  if (runtimeBlocked) {
    addAction(
      actions,
      'verification-runtime:repair-required',
      repairCommand
    );
  }
  return {
    schema: 'specnav.verification.runtime-status.v1',
    ok: blockers.length === 0,
    readiness: blockers.length === 0 ? 'ready' : 'blocked',
    runtime_version: runtimeLock.runtime_version,
    runtime_root: runtimeRoot,
    requires_midscene: requiresMidscene,
    checks,
    blockers,
    warnings,
    actions,
    fallback_used: false
  };
}

module.exports = {
  addAction,
  addUnique,
  blockedResult,
  blocker,
  defaultAccessPath,
  defaultLoadPackage,
  defaultProbeBrowser,
  doctorRuntime,
  probeProvider,
  safeRuntimePath,
  sameKernelReceipt,
  warning
};
