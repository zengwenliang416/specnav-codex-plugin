'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('./identity');
const { ensureSafeDirectory } = require('./paths');
const { blocked } = require('./blockers');

const CONTENT_TYPE_EXTENSIONS = Object.freeze({
  'application/json': 'json',
  'application/zip': 'zip',
  'text/html': 'html',
  'text/plain': 'txt',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/webm': 'webm'
});

function extensionForContentType(contentType) {
  return CONTENT_TYPE_EXTENSIONS[contentType] || 'bin';
}

function objectRelativePath(digest, contentType) {
  return path.posix.join(
    'objects',
    `${digest}.${extensionForContentType(contentType)}`
  );
}

function existingObjectMatches(file, bytes, digest) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    if (stat.size !== bytes.length) return false;
    return sha256(fs.readFileSync(file)) === digest;
  } catch (error) {
    return false;
  }
}

function writeContentAddressed(options) {
  const {
    root,
    rootState,
    bytes,
    contentType
  } = options;
  const digest = sha256(bytes);
  const relativePath = objectRelativePath(digest, contentType);
  const objectFile = path.join(root, ...relativePath.split('/'));
  let directory;
  try {
    directory = ensureSafeDirectory(rootState, path.dirname(objectFile));
  } catch (error) {
    return blocked(
      error.message || 'verification-evidence:object-write-failed',
      relativePath
    );
  }

  if (fs.existsSync(objectFile)) {
    return existingObjectMatches(objectFile, bytes, digest)
      ? {
          ok: true,
          reused: true,
          path: relativePath,
          sha256: digest,
          size: bytes.length,
          blockers: []
        }
      : blocked(
          'verification-evidence:object-conflict',
          relativePath
        );
  }

  const tempFile = path.join(
    directory,
    `.${digest}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(tempFile, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.copyFileSync(tempFile, objectFile, fs.constants.COPYFILE_EXCL);
    const published = fs.openSync(objectFile, 'r');
    try {
      fs.fsyncSync(published);
    } finally {
      fs.closeSync(published);
    }
    fs.unlinkSync(tempFile);
    return {
      ok: true,
      reused: false,
      path: relativePath,
      sha256: digest,
      size: bytes.length,
      blockers: []
    };
  } catch (error) {
    try {
      if (fd !== undefined) fs.closeSync(fd);
    } catch {
      // The write failure below remains authoritative.
    }
    try {
      fs.rmSync(tempFile, { force: true });
    } catch {
      // Do not replace the primary blocker with cleanup detail.
    }
    if (
      error?.code === 'EEXIST'
      && existingObjectMatches(objectFile, bytes, digest)
    ) {
      return {
        ok: true,
        reused: true,
        path: relativePath,
        sha256: digest,
        size: bytes.length,
        blockers: []
      };
    }
    try {
      if (
        error?.code !== 'EEXIST'
        && fs.existsSync(objectFile)
        && !existingObjectMatches(objectFile, bytes, digest)
      ) {
        fs.rmSync(objectFile, { force: true });
      }
    } catch {
      // Do not replace the primary blocker with cleanup detail.
    }
    if (
      fs.existsSync(objectFile)
      && !existingObjectMatches(objectFile, bytes, digest)
    ) {
      return blocked(
        'verification-evidence:object-conflict',
        relativePath
      );
    }
    return blocked(
      'verification-evidence:object-write-failed',
      relativePath,
      `${error?.code || 'ERROR'}: ${
        error instanceof Error ? error.message : String(error)
      }; target=${objectFile}`
    );
  }
}

module.exports = {
  CONTENT_TYPE_EXTENSIONS,
  extensionForContentType,
  objectRelativePath,
  existingObjectMatches,
  writeContentAddressed
};
