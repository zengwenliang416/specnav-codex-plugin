'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOCK_FILE = path.resolve(
  __dirname,
  '../../assets/runtime/verification-runtime-lock.json'
);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function loadRuntimeLock(file = LOCK_FILE) {
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  return deepFreeze(lock);
}

function nodeMajor(version) {
  const match = String(version || '').match(/^v?(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : null;
}

function validateKernelIdentity(kernel, expected) {
  if (!kernel || typeof kernel !== 'object' || Array.isArray(kernel)) {
    return ['verification-runtime:missing-kernel-identity'];
  }

  const fields = [
    ['name', 'name'],
    ['version', 'version'],
    ['apiVersion', 'api_version'],
    ['contractVersion', 'contract_version'],
    ['contractDigest', 'contract_digest']
  ];
  const blockers = [];

  for (const [environmentField, lockField] of fields) {
    const value = kernel[environmentField];
    if (value === undefined || value === null || value === '') {
      blockers.push(`verification-runtime:missing-kernel-identity:${environmentField}`);
      continue;
    }
    if (value !== expected[lockField]) {
      const blockerField = environmentField
        .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      blockers.push(`verification-runtime:kernel-${blockerField}-mismatch:${value}`);
    }
  }

  return blockers;
}

function resolveRuntimeLock(requestedVersion, environment = {}, lock = loadRuntimeLock()) {
  const blockers = [];

  if (requestedVersion !== lock.runtime_version) {
    return {
      ok: false,
      lock: null,
      blockers: [`verification-runtime:unsupported-version:${requestedVersion || '<missing>'}`]
    };
  }

  const major = nodeMajor(environment.nodeVersion);
  if (
    major === null
    || major < lock.node.minimum_major
    || major > lock.node.maximum_major
  ) {
    blockers.push(`verification-runtime:unsupported-node:${environment.nodeVersion || '<missing>'}`);
  }

  const platformKey = `${environment.platform || '<missing>'}-${environment.arch || '<missing>'}`;
  if (!lock.platforms.includes(platformKey)) {
    blockers.push(`verification-runtime:unsupported-platform:${platformKey}`);
  }

  blockers.push(...validateKernelIdentity(environment.kernel, lock.kernel));

  return {
    ok: blockers.length === 0,
    lock: blockers.length === 0 ? lock : null,
    blockers
  };
}

module.exports = {
  LOCK_FILE,
  loadRuntimeLock,
  resolveRuntimeLock,
  validateKernelIdentity
};
