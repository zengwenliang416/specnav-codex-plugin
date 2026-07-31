'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { installRuntime, runtimeBaseDefault } = require('./installer');
const { resolveRuntimeLock } = require('./lock-manifest');

function stableToken(date) {
  return date.toISOString().replace(/[-:.TZ]/g, '');
}

function backupDirectory(runtimeBase, runtimeVersion, now) {
  return path.join(
    runtimeBase,
    `.${runtimeVersion}.replaced-${stableToken(now)}-${process.pid}-${crypto.randomUUID()}`
  );
}

async function repairRuntime(options = {}) {
  const {
    requestedVersion,
    environment,
    projectRoot = process.cwd(),
    runtimeBase = runtimeBaseDefault(),
    lock,
    adapters,
    onEvent = () => {},
    now = new Date(),
    install = installRuntime
  } = options;
  const resolved = resolveRuntimeLock(requestedVersion, environment, lock);
  if (!resolved.ok) {
    throw new Error(resolved.blockers.join(','));
  }

  fs.mkdirSync(runtimeBase, { recursive: true });
  const managedRuntimeBase = fs.realpathSync(runtimeBase);
  const targetRoot = path.join(managedRuntimeBase, resolved.lock.runtime_version);
  if (!fs.existsSync(targetRoot)) {
    return install({
      requestedVersion,
      environment,
      projectRoot,
      runtimeBase: managedRuntimeBase,
      lock,
      adapters,
      onEvent
    });
  }

  const previousRuntimeRoot = backupDirectory(
    managedRuntimeBase,
    resolved.lock.runtime_version,
    now
  );
  fs.renameSync(targetRoot, previousRuntimeRoot);
  onEvent({
    schema: 'specnav.verification.runtime-repair-event.v1',
    event: 'previous-runtime-preserved',
    runtime_version: resolved.lock.runtime_version,
    recorded_at: new Date().toISOString(),
    previous_runtime_root: previousRuntimeRoot
  });

  try {
    const installed = await install({
      requestedVersion,
      environment,
      projectRoot,
      runtimeBase: managedRuntimeBase,
      lock,
      adapters,
      onEvent
    });
    return {
      ...installed,
      status: 'repaired',
      previousRuntimeRoot,
      fallback_used: false
    };
  } catch (error) {
    if (!fs.existsSync(targetRoot) && fs.existsSync(previousRuntimeRoot)) {
      fs.renameSync(previousRuntimeRoot, targetRoot);
    }
    throw error;
  }
}

module.exports = {
  backupDirectory,
  repairRuntime,
  stableToken
};
