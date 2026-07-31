'use strict';

const { sha256 } = require('./identity');
const { readStoreFile } = require('./paths');
const { blocked } = require('./blockers');

function errorDetail(error, target) {
  const code = typeof error?.code === 'string' ? error.code : 'ERROR';
  const message = error instanceof Error ? error.message : String(error);
  return `${code}: ${message}; target=${target}`;
}

function readEvidenceObject(file, evidence, pathPolicy) {
  const read = readStoreFile(
    pathPolicy?.rootState,
    pathPolicy?.root,
    file
  );
  if (!read.ok) {
    const pathFailure = [
      'verification-evidence:store-root-invalid',
      'verification-evidence:store-root-outside-change',
      'verification-evidence:store-root-symlink',
      'verification-evidence:change-root-missing',
      'verification-evidence:store-file-path-unsafe'
    ].includes(read.id);
    return blocked(
      pathFailure
        ? 'verification-evidence:object-path-unsafe'
        : 'verification-evidence:object-read-failed',
      evidence.path,
      read.error ? errorDetail(read.error, file) : null
    );
  }
  if (read.missing) {
    return blocked(
      'verification-evidence:object-missing',
      evidence.path
    );
  }

  const bytes = read.bytes;
  const blockers = [];
  if (bytes.length !== evidence.size) {
    blockers.push({
      id: 'verification-evidence:object-size-mismatch',
      artifact: evidence.id,
      detail: `${evidence.size}:${bytes.length}`
    });
  }
  const digest = sha256(bytes);
  if (digest !== evidence.sha256) {
    blockers.push({
      id: 'verification-evidence:object-hash-mismatch',
      artifact: evidence.id,
      detail: `${evidence.sha256}:${digest}`
    });
  }
  return {
    ok: blockers.length === 0,
    bytes,
    blockers
  };
}

module.exports = {
  readEvidenceObject
};
