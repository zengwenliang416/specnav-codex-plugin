#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RECEIPT_SIGNATURE_ALGORITHM = 'hmac-sha256';
const RECEIPT_SCHEMA = 'specnav.validationLog.v2';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function keyBytes(value) {
  const bytes = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : null;
  return bytes && bytes.length >= 32 ? bytes : null;
}

function unsignedReceipt(receipt) {
  const unsigned = structuredClone(receipt);
  delete unsigned.receipt_signature;
  return unsigned;
}

function receiptSignature(key, receipt) {
  return crypto.createHmac('sha256', key)
    .update(canonicalJson(unsignedReceipt(receipt)))
    .digest('hex');
}

function createValidationReceiptAuthority(options = {}) {
  const key = keyBytes(options.key);
  const authorityDigest = options.authorityDigest;
  if (
    !key
    || typeof authorityDigest !== 'string'
    || !/^[0-9a-f]{64}$/.test(authorityDigest)
  ) {
    throw new Error('validation-receipt-authority:config-invalid');
  }

  function sign(receipt) {
    if (
      !receipt
      || typeof receipt !== 'object'
      || Array.isArray(receipt)
      || Object.hasOwn(receipt, 'receipt_signature')
      || typeof receipt.evidence_log !== 'string'
      || typeof receipt.evidence_log_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(receipt.evidence_log_sha256)
      || !Number.isInteger(receipt.evidence_log_size)
      || receipt.evidence_log_size < 0
    ) {
      throw new Error('validation-receipt-authority:receipt-invalid');
    }
    const unsigned = {
      ...structuredClone(receipt),
      receipt_signature_algorithm: RECEIPT_SIGNATURE_ALGORITHM,
      runtime_authority_digest: authorityDigest
    };
    return {
      ...unsigned,
      receipt_signature: receiptSignature(key, unsigned)
    };
  }

  function verify(receipt) {
    if (
      !receipt
      || typeof receipt !== 'object'
      || Array.isArray(receipt)
      || receipt.schema !== RECEIPT_SCHEMA
      || receipt.attestation !== 'system-executed'
      || receipt.recorded_by !== 'specnav-evidence-runner'
      || receipt.receipt_signature_algorithm !== RECEIPT_SIGNATURE_ALGORITHM
      || receipt.runtime_authority_digest !== authorityDigest
      || typeof receipt.evidence_log !== 'string'
      || typeof receipt.evidence_log_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(receipt.evidence_log_sha256)
      || !Number.isInteger(receipt.evidence_log_size)
      || receipt.evidence_log_size < 0
      || typeof receipt.receipt_signature !== 'string'
      || !/^[0-9a-f]{64}$/.test(receipt.receipt_signature)
    ) {
      return false;
    }
    const expected = Buffer.from(receiptSignature(key, receipt), 'hex');
    const actual = Buffer.from(receipt.receipt_signature, 'hex');
    return actual.length === expected.length
      && crypto.timingSafeEqual(actual, expected);
  }

  return Object.freeze({
    authorityDigest,
    sign,
    verify
  });
}

function resolveManagedValidationReceiptAuthority(options = {}) {
  if (
    typeof options.projectRoot !== 'string'
    || typeof options.changeDir !== 'string'
  ) {
    throw new Error('validation-receipt-authority:project-context-required');
  }
  const projectRoot = path.resolve(options.projectRoot);
  const changeDir = path.resolve(options.changeDir);
  const relativeChange = path.relative(projectRoot, changeDir);
  if (
    relativeChange === ''
    || relativeChange.startsWith('..')
    || path.isAbsolute(relativeChange)
  ) {
    throw new Error('validation-receipt-authority:change-root-invalid');
  }
  let current = projectRoot;
  try {
    for (const segment of relativeChange.split(path.sep)) {
      current = path.join(current, segment);
      const status = fs.lstatSync(current);
      if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error('unsafe-change-root');
      }
    }
    const projectReal = fs.realpathSync(projectRoot);
    const changeReal = fs.realpathSync(changeDir);
    const realRelative = path.relative(projectReal, changeReal);
    if (
      realRelative === ''
      || realRelative.startsWith('..')
      || path.isAbsolute(realRelative)
    ) {
      throw new Error('change-root-outside-project');
    }
  } catch (error) {
    throw new Error(
      `validation-receipt-authority:change-root-unsafe:${error instanceof Error ? error.message : String(error)}`
    );
  }
  const statusFile = path.join(changeDir, 'verify', 'v2', 'runtime-status.json');
  let runtimeStatus;
  try {
    const status = fs.lstatSync(statusFile);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new Error('unsafe-runtime-status');
    }
    runtimeStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  } catch (error) {
    throw new Error(
      `validation-receipt-authority:runtime-status-invalid:${error instanceof Error ? error.message : String(error)}`
    );
  }

  const kernel = options.kernel || require('../kernel');
  const runtimeAuthority = options.runtimeAuthority
    || kernel.createRuntimeAuthority({
      projectRoot,
      ...(options.runtimeAuthorityOptions || {})
    });
  const resolution = runtimeAuthority.resolve(runtimeStatus);
  if (
    !resolution
    || resolution.ok !== true
    || !resolution.signingKey
    || !resolution.authority
    || typeof resolution.authority.digest !== 'string'
  ) {
    const blockerIds = Array.isArray(resolution?.blockers)
      ? resolution.blockers.map((entry) => entry?.id || String(entry))
      : [];
    throw new Error(
      `validation-receipt-authority:managed-runtime-unavailable:${blockerIds.join(',') || 'unknown'}`
    );
  }
  return createValidationReceiptAuthority({
    key: resolution.signingKey,
    authorityDigest: resolution.authority.digest
  });
}

module.exports = {
  RECEIPT_SCHEMA,
  RECEIPT_SIGNATURE_ALGORITHM,
  canonicalJson,
  createValidationReceiptAuthority,
  resolveManagedValidationReceiptAuthority
};
