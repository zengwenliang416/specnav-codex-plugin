'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const metadata = require('../metadata');
const {
  LOCK_FILE,
  loadRuntimeLock
} = require('./lock-manifest');
const { runtimeBaseDefault } = require('./installer');
const {
  moduleTreeDigest
} = require('./runtime-integrity');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function blocker(id, artifact = 'verify/v2/runtime-status.json', detail = null) {
  return { id, artifact, detail };
}

function authorityProjection(status, staticEvidence = {}) {
  return {
    runtime_version: status.runtime_version,
    runtime_root: status.runtime_root,
    requires_midscene: status.requires_midscene === true,
    runtime_lock_sha256: staticEvidence.runtimeLockSha256 || null,
    install_receipt_sha256: staticEvidence.installReceiptSha256 || null,
    package_lock_sha256: staticEvidence.packageLockSha256 || null,
    module_tree_sha256: staticEvidence.moduleTreeSha256 || null,
    browser_executables: staticEvidence.browserExecutables || [],
    kernel_contract_digest: metadata.contractDigest
  };
}

function createRuntimeAuthority(options = {}) {
  const lock = options.lock || loadRuntimeLock();
  const runtimeBase = path.resolve(
    options.runtimeBase
      || process.env.SPECNAV_VERIFICATION_RUNTIME_BASE
      || runtimeBaseDefault()
  );
  function resolve(persistedStatus) {
    const blockers = [];
    if (
      !persistedStatus
      || typeof persistedStatus !== 'object'
      || Array.isArray(persistedStatus)
      || persistedStatus.ok !== true
      || persistedStatus.readiness !== 'ready'
      || persistedStatus.fallback_used !== false
      || persistedStatus.runtime_version !== lock.runtime_version
    ) {
      return {
        ok: false,
        runtimeRoot: null,
        runtimeStatus: null,
        authority: null,
        blockers: [blocker(
          'verification-runtime:authority-status-invalid'
        )]
      };
    }

    let currentRoot;
    let receipt;
    let receiptBytes;
    let packageLockBytes;
    let moduleDigest;
    try {
      currentRoot = fs.realpathSync(path.join(runtimeBase, lock.runtime_version));
      if (
        fs.lstatSync(currentRoot).isSymbolicLink()
        || !fs.statSync(currentRoot).isDirectory()
      ) {
        throw new Error('runtime-root-unsafe');
      }
      receiptBytes = fs.readFileSync(path.join(
        currentRoot,
        'install-receipt.json'
      ));
      receipt = JSON.parse(receiptBytes.toString('utf8'));
      packageLockBytes = fs.readFileSync(path.join(
        currentRoot,
        'package-lock.json'
      ));
      moduleDigest = moduleTreeDigest(currentRoot);
    } catch (error) {
      return {
        ok: false,
        runtimeRoot: null,
        runtimeStatus: null,
        authority: null,
        blockers: [blocker(
          'verification-runtime:authority-static-check-failed',
          'managed-runtime',
          error instanceof Error ? error.message : String(error)
        )]
      };
    }

    let persistedRoot;
    try {
      persistedRoot = fs.realpathSync(persistedStatus.runtime_root);
    } catch (error) {
      blockers.push(blocker(
        'verification-runtime:authority-root-missing',
        'managed-runtime',
        error instanceof Error ? error.message : String(error)
      ));
    }
    if (persistedRoot && currentRoot && persistedRoot !== currentRoot) {
      blockers.push(blocker(
        'verification-runtime:authority-root-mismatch',
        'verify/v2/runtime-status.json',
        { persisted: persistedRoot, authoritative: currentRoot }
      ));
    }
    const packageLockSha256 = sha256(packageLockBytes);
    const expectedPackages = Object.entries(lock.packages)
      .map(([name, spec]) => ({
        name,
        version: spec.version,
        integrity: spec.integrity
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const receiptPackages = Array.isArray(receipt.packages)
      ? receipt.packages.map((entry) => ({
          name: entry.name,
          version: entry.version,
          integrity: entry.integrity
        })).sort((left, right) => left.name.localeCompare(right.name))
      : [];
    if (
      receipt.schema !== 'specnav.verification.runtime-install-receipt.v1'
      || receipt.status !== 'installed'
      || receipt.fallback_used !== false
      || receipt.runtime_version !== lock.runtime_version
      || receipt.package_lock_sha256 !== packageLockSha256
      || receipt.module_tree_sha256 !== moduleDigest
      || canonicalJson(receiptPackages) !== canonicalJson(expectedPackages)
      || receipt.kernel?.contract_digest !== metadata.contractDigest
    ) {
      blockers.push(blocker(
        'verification-runtime:authority-receipt-invalid',
        'managed-runtime/install-receipt.json'
      ));
    }
    const browserExecutables = [];
    for (const browser of Array.isArray(receipt.browsers)
      ? receipt.browsers
      : []) {
      try {
        const executable = path.resolve(currentRoot, browser.executable);
        const relative = path.relative(currentRoot, executable);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error('outside-runtime');
        }
        const actual = sha256(fs.readFileSync(executable));
        if (actual !== browser.executable_sha256) {
          throw new Error('hash-mismatch');
        }
        browserExecutables.push({
          name: browser.name,
          executable: browser.executable,
          sha256: actual
        });
      } catch (error) {
        blockers.push(blocker(
          'verification-runtime:authority-browser-invalid',
          browser?.name || 'browser',
          error instanceof Error ? error.message : String(error)
        ));
      }
    }
    const trustedStatus = {
      ...persistedStatus,
      runtime_root: currentRoot
    };
    const projection = authorityProjection(trustedStatus, {
      runtimeLockSha256: sha256(fs.readFileSync(LOCK_FILE)),
      installReceiptSha256: sha256(receiptBytes),
      packageLockSha256,
      moduleTreeSha256: moduleDigest,
      browserExecutables
    });
    return {
      ok: blockers.length === 0,
      runtimeRoot: blockers.length === 0 ? currentRoot : null,
      runtimeStatus: blockers.length === 0 ? trustedStatus : null,
      authority: blockers.length === 0
        ? {
            schema: 'specnav.verification.runtime-authority.v1',
            digest: sha256(canonicalJson(projection)),
            ...projection
          }
        : null,
      blockers
    };
  }

  return Object.freeze({
    resolve,
    runtimeBase
  });
}

module.exports = {
  authorityProjection,
  createRuntimeAuthority
};
