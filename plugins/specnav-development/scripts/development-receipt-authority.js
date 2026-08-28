#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RECEIPT_SIGNATURE_ALGORITHM = 'hmac-sha256';
const RECEIPT_SCHEMA = 'specnav.validationLog.v2';
const RECEIPT_PRODUCER = 'specnav-development-evidence-runner';
const KEY_BYTES = 32;

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
      || receipt.recorded_by !== RECEIPT_PRODUCER
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
  let gitCommonDir;
  try {
    const configured = execFileSync(
      'git',
      ['-C', projectRoot, 'rev-parse', '--git-common-dir'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    ).trim();
    gitCommonDir = fs.realpathSync(
      path.isAbsolute(configured)
        ? configured
        : path.resolve(projectRoot, configured)
    );
    if (!fs.statSync(gitCommonDir).isDirectory()) {
      throw new Error('git-common-dir-not-directory');
    }
  } catch (error) {
    throw new Error(
      `validation-receipt-authority:git-private-state-unavailable:${error instanceof Error ? error.message : String(error)}`
    );
  }

  const authorityDir = path.join(gitCommonDir, 'specnav');
  const keyFile = path.join(authorityDir, 'development-receipt.key');
  try {
    if (!fs.existsSync(authorityDir)) {
      fs.mkdirSync(authorityDir, { mode: 0o700 });
    }
    const authorityDirStatus = fs.lstatSync(authorityDir);
    if (
      authorityDirStatus.isSymbolicLink()
      || !authorityDirStatus.isDirectory()
    ) {
      throw new Error('authority-directory-unsafe');
    }
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, crypto.randomBytes(KEY_BYTES), {
        flag: 'wx',
        mode: 0o600
      });
    }
    const keyStatus = fs.lstatSync(keyFile);
    if (keyStatus.isSymbolicLink() || !keyStatus.isFile()) {
      throw new Error('authority-key-unsafe');
    }
    const key = fs.readFileSync(keyFile);
    if (key.length !== KEY_BYTES) {
      throw new Error('authority-key-size-invalid');
    }
    const authorityDigest = crypto.createHash('sha256')
      .update('specnav-development-receipt-authority.v1\0')
      .update(key)
      .digest('hex');
    return createValidationReceiptAuthority({
      key,
      authorityDigest
    });
  } catch (error) {
    throw new Error(
      `validation-receipt-authority:git-private-state-invalid:${error instanceof Error ? error.message : String(error)}`
    );
  }
}

module.exports = {
  RECEIPT_PRODUCER,
  RECEIPT_SCHEMA,
  RECEIPT_SIGNATURE_ALGORITHM,
  canonicalJson,
  createValidationReceiptAuthority,
  resolveManagedValidationReceiptAuthority
};
