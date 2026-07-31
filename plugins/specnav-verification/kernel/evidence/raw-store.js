'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson } = require('./identity');
const {
  ensureSafeDirectory,
  readStoreFile
} = require('./paths');
const { blocked } = require('./blockers');

function rawFileFor(root) {
  return path.join(root, 'raw.jsonl');
}

function parseRawBytes(bytes, artifact = 'raw.jsonl') {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes || '');
  if (bytes.length === 0) {
    return { ok: true, records: [], bytes };
  }
  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      return blocked(
        'verification-evidence:raw-json-invalid',
        artifact,
        `empty JSONL record at line ${index + 1}`
      );
    }
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return blocked(
          'verification-evidence:raw-json-invalid',
          artifact,
          `non-object JSONL record at line ${index + 1}`
        );
      }
      records.push(value);
    } catch {
      return blocked(
        'verification-evidence:raw-json-invalid',
        artifact,
        `invalid JSON at line ${index + 1}`
      );
    }
  }
  return { ok: true, records, bytes };
}

function readRaw(root, rootState) {
  const file = rawFileFor(root);
  const read = readStoreFile(rootState, root, file);
  if (!read.ok) {
    if (
      read.id === 'verification-evidence:store-root-invalid'
      || read.id === 'verification-evidence:store-root-outside-change'
      || read.id === 'verification-evidence:store-root-symlink'
      || read.id === 'verification-evidence:change-root-missing'
    ) {
      return blocked(read.id, 'raw.jsonl');
    }
    return blocked(
      read.id === 'verification-evidence:store-file-path-unsafe'
        ? 'verification-evidence:raw-path-unsafe'
        : 'verification-evidence:raw-read-failed',
      'raw.jsonl',
      read.error ? errorDetail(read.error, file) : null
    );
  }
  if (read.missing) {
    return {
      ok: true,
      records: [],
      bytes: Buffer.alloc(0),
      file,
      missing: true
    };
  }
  const parsed = parseRawBytes(read.bytes, 'raw.jsonl');
  return parsed.ok
    ? { ...parsed, file, missing: false }
    : parsed;
}

function existingById(records, id) {
  return records.find((record) => record.id === id) || null;
}

function errorDetail(error, target) {
  const code = typeof error?.code === 'string' ? error.code : 'ERROR';
  const message = error instanceof Error ? error.message : String(error);
  return `${code}: ${message}; target=${target}`;
}

function writeAll(fd, bytes, writer = fs.writeSync) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writer(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error('verification-evidence:raw-short-write');
    }
    offset += written;
  }
  return offset;
}

function appendRaw(options) {
  const {
    root,
    rootState,
    record
  } = options;
  let rawDir;
  try {
    rawDir = ensureSafeDirectory(rootState, root);
  } catch (error) {
    return blocked(
      error.message || 'verification-evidence:raw-append-failed',
      'raw.jsonl'
    );
  }
  const lockFile = path.join(rawDir, '.append.lock');
  let lockFd;
  try {
    lockFd = fs.openSync(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return blocked(
        'verification-evidence:raw-lock-held',
        'raw.jsonl'
      );
    }
    return blocked(
      'verification-evidence:raw-append-failed',
      'raw.jsonl',
      errorDetail(error, lockFile)
    );
  }

  try {
    const current = readRaw(root, rootState);
    if (!current.ok) return current;
    const existing = existingById(current.records, record.id);
    if (existing) {
      if (canonicalJson(existing) === canonicalJson(record)) {
        return {
          ok: true,
          idempotent: true,
          record: existing,
          blockers: []
        };
      }
      return blocked(
        'verification-evidence:evidence-id-conflict',
        'raw.jsonl',
        record.id
      );
    }

    const rawFile = rawFileFor(root);
    const fd = fs.openSync(
      rawFile,
      fs.constants.O_APPEND
        | fs.constants.O_CREAT
        | fs.constants.O_WRONLY
        | (fs.constants.O_NOFOLLOW || 0),
      0o600
    );
    try {
      writeAll(fd, Buffer.from(`${JSON.stringify(record)}\n`));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return {
      ok: true,
      idempotent: false,
      record,
      blockers: []
    };
  } catch (error) {
    return blocked(
      'verification-evidence:raw-append-failed',
      'raw.jsonl',
      errorDetail(error, rawFileFor(root))
    );
  } finally {
    try {
      if (lockFd !== undefined) fs.closeSync(lockFd);
    } catch {
      // The append result remains authoritative.
    }
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // A stale lock is safer than pretending another append can proceed.
    }
  }
}

module.exports = {
  rawFileFor,
  parseRawBytes,
  readRaw,
  existingById,
  errorDetail,
  writeAll,
  appendRaw
};
