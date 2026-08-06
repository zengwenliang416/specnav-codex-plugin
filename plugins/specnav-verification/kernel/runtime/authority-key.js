'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function authoritySpec(lock) {
  const value = lock?.authority;
  if (
    !value
    || value.algorithm !== 'hmac-sha256'
    || typeof value.relative_path !== 'string'
    || value.relative_path.length === 0
    || path.isAbsolute(value.relative_path)
    || !Number.isInteger(value.key_bytes)
    || value.key_bytes < 32
    || value.file_mode !== '0600'
  ) {
    throw new Error('verification-runtime:authority-lock-invalid');
  }
  return value;
}

function authorityKeyPath(runtimeRoot, lock) {
  const spec = authoritySpec(lock);
  const resolved = path.resolve(runtimeRoot, spec.relative_path);
  const relative = path.relative(runtimeRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('verification-runtime:authority-path-invalid');
  }
  return resolved;
}

function writeAuthorityKey(runtimeRoot, lock, randomBytes = crypto.randomBytes) {
  const spec = authoritySpec(lock);
  const file = authorityKeyPath(runtimeRoot, lock);
  const key = randomBytes(spec.key_bytes);
  if (!Buffer.isBuffer(key) || key.length !== spec.key_bytes) {
    throw new Error('verification-runtime:authority-key-generation-invalid');
  }
  const fd = fs.openSync(
    file,
    fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | fs.constants.O_WRONLY
      | (fs.constants.O_NOFOLLOW || 0),
    0o600
  );
  try {
    fs.writeFileSync(fd, key);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return {
    algorithm: spec.algorithm,
    relative_path: spec.relative_path,
    key_bytes: key.length,
    key_sha256: crypto.createHash('sha256').update(key).digest('hex'),
    file_mode: spec.file_mode
  };
}

function readAuthorityKey(runtimeRoot, lock, expected = null) {
  const spec = authoritySpec(lock);
  const file = authorityKeyPath(runtimeRoot, lock);
  let fd;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    const opened = fs.fstatSync(fd);
    const current = fs.lstatSync(file);
    if (
      !opened.isFile()
      || current.isSymbolicLink()
      || !current.isFile()
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || (opened.mode & 0o777) !== 0o600
    ) {
      throw new Error('verification-runtime:authority-key-unsafe');
    }
    const key = fs.readFileSync(fd);
    const digest = crypto.createHash('sha256').update(key).digest('hex');
    if (
      key.length !== spec.key_bytes
      || (
        expected
        && (
          expected.algorithm !== spec.algorithm
          || expected.relative_path !== spec.relative_path
          || expected.key_bytes !== key.length
          || expected.key_sha256 !== digest
          || expected.file_mode !== spec.file_mode
        )
      )
    ) {
      throw new Error('verification-runtime:authority-key-mismatch');
    }
    return {
      key,
      receipt: {
        algorithm: spec.algorithm,
        relative_path: spec.relative_path,
        key_bytes: key.length,
        key_sha256: digest,
        file_mode: spec.file_mode
      }
    };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = {
  authorityKeyPath,
  authoritySpec,
  readAuthorityKey,
  writeAuthorityKey
};
