'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256 } = require('./identity');
const {
  ensureSafeDirectory,
  readStoreFile
} = require('./paths');
const { readRaw } = require('./raw-store');
const { blocked } = require('./blockers');

const RAW_ARTIFACT = 'raw.jsonl';
const INDEX_ARTIFACT = 'index.json';
const CACHE_ARTIFACT = 'cache/index-meta.json';

function validateRecords(records, schemaRegistry) {
  const ids = new Map();
  for (const record of records) {
    const validation = schemaRegistry.validate('evidence', record, {
      artifactPath: RAW_ARTIFACT
    });
    if (!validation.ok) {
      return {
        ok: false,
        blockers: validation.blockers
      };
    }
    const prior = ids.get(record.id);
    if (prior) {
      return blocked(
        canonicalJson(prior) === canonicalJson(record)
          ? 'verification-evidence:duplicate-raw-id'
          : 'verification-evidence:evidence-id-conflict',
        RAW_ARTIFACT,
        record.id
      );
    }
    ids.set(record.id, record);
  }
  return { ok: true, blockers: [] };
}

function ioDetail(error, file) {
  const code = typeof error?.code === 'string' ? error.code : 'ERROR';
  const message = error instanceof Error ? error.message : String(error);
  return `${code}: ${message}; target=${file}`;
}

function readOptionalFile(rootState, file) {
  const read = readStoreFile(rootState, rootState.root, file);
  if (!read.ok) {
    if (
      read.id === 'verification-evidence:store-root-invalid'
      || read.id === 'verification-evidence:store-root-outside-change'
      || read.id === 'verification-evidence:store-root-symlink'
      || read.id === 'verification-evidence:change-root-missing'
    ) {
      return blocked(read.id, file);
    }
    return blocked(
      read.id === 'verification-evidence:store-file-path-unsafe'
        ? 'verification-evidence:derived-path-unsafe'
        : 'verification-evidence:derived-read-failed',
      file,
      read.error ? ioDetail(read.error, file) : `unsafe target=${file}`
    );
  }
  if (read.missing) {
    return {
      ok: true,
      exists: false,
      bytes: null,
      blockers: []
    };
  }
  return {
    ok: true,
    exists: true,
    bytes: read.bytes,
    blockers: []
  };
}

function writeBufferAtomic(rootState, file, bytes) {
  let directory;
  try {
    directory = ensureSafeDirectory(rootState, path.dirname(file));
  } catch (error) {
    return blocked(
      error.message || 'verification-evidence:index-write-failed',
      path.basename(file),
      ioDetail(error, file)
    );
  }
  const tempFile = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(tempFile, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempFile, file);
    return { ok: true, blockers: [] };
  } catch (error) {
    try {
      if (fd !== undefined) fs.closeSync(fd);
    } catch {
      // Preserve the primary blocker.
    }
    try {
      fs.rmSync(tempFile, { force: true });
    } catch {
      // Preserve the primary blocker.
    }
    return blocked(
      'verification-evidence:index-write-failed',
      path.basename(file),
      ioDetail(error, file)
    );
  }
}

function writeJsonAtomic(rootState, file, value) {
  return writeBufferAtomic(
    rootState,
    file,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  );
}

function publicationMatches(rootState, file, sourceDigest) {
  try {
    const read = readStoreFile(rootState, rootState.root, file);
    if (!read.ok || read.missing) return false;
    const value = JSON.parse(read.bytes.toString('utf8'));
    return value.source_digest === sourceDigest;
  } catch {
    return false;
  }
}

function restorePublication(options) {
  const {
    rootState,
    file,
    previous,
    sourceDigest
  } = options;
  if (!publicationMatches(rootState, file, sourceDigest)) {
    return { ok: true, skipped: true, blockers: [] };
  }
  if (previous.exists) {
    const restored = writeBufferAtomic(rootState, file, previous.bytes);
    if (!restored.ok) {
      return {
        ok: false,
        blockers: [
          ...restored.blockers,
          {
            id: 'verification-evidence:derived-rollback-failed',
            artifact: file,
            detail: null
          }
        ]
      };
    }
    return { ok: true, skipped: false, blockers: [] };
  }
  try {
    fs.rmSync(file, { force: true });
    return { ok: true, skipped: false, blockers: [] };
  } catch (error) {
    return blocked(
      'verification-evidence:derived-rollback-failed',
      file,
      ioDetail(error, file)
    );
  }
}

function withRollback(primary, rollbacks, extra = {}) {
  const rollbackBlockers = rollbacks.flatMap((result) => (
    result?.ok === false ? result.blockers : []
  ));
  return {
    ok: false,
    blockers: [
      ...(primary.blockers || []),
      ...rollbackBlockers
    ],
    raw_preserved: true,
    ...extra
  };
}

function rebuildEvidenceIndex(options) {
  const {
    root,
    rootState,
    changeId,
    schemaRegistry,
    clock
  } = options;
  const raw = readRaw(root, rootState);
  if (!raw.ok) return raw;
  if (raw.missing) {
    return blocked(
      'verification-evidence:raw-missing',
      RAW_ARTIFACT
    );
  }
  const recordsValidation = validateRecords(raw.records, schemaRegistry);
  if (!recordsValidation.ok) return recordsValidation;

  const entries = [...raw.records].sort((left, right) => (
    String(left.captured_at).localeCompare(String(right.captured_at))
    || String(left.id).localeCompare(String(right.id))
  ));
  const generatedAt = entries.length > 0
    ? entries.at(-1).captured_at
    : '1970-01-01T00:00:00.000Z';
  const index = {
    schema: 'specnav.verification.evidence-index.v1',
    index_version: Math.max(1, entries.length),
    change_id: changeId,
    generated_at: generatedAt,
    source_raw: RAW_ARTIFACT,
    source_digest: sha256(raw.bytes),
    record_count: entries.length,
    entries
  };
  const indexValidation = schemaRegistry.validate('evidence-index', index, {
    artifactPath: INDEX_ARTIFACT
  });
  if (!indexValidation.ok) {
    return {
      ok: false,
      blockers: indexValidation.blockers
    };
  }

  let cacheGeneratedAt;
  try {
    cacheGeneratedAt = clock();
  } catch (error) {
    return blocked(
      'verification-evidence:cache-metadata-invalid',
      CACHE_ARTIFACT,
      ioDetail(error, CACHE_ARTIFACT)
    );
  }
  if (typeof cacheGeneratedAt !== 'string' || cacheGeneratedAt === '') {
    return blocked(
      'verification-evidence:cache-metadata-invalid',
      CACHE_ARTIFACT
    );
  }
  const cache = {
    schema: 'specnav.verification.evidence-cache-meta.v1',
    generated_at: cacheGeneratedAt,
    index_path: INDEX_ARTIFACT,
    source_raw: index.source_raw,
    source_digest: index.source_digest,
    index_version: index.index_version,
    record_count: index.record_count
  };
  const indexFile = path.join(root, INDEX_ARTIFACT);
  const cacheFile = path.join(root, ...CACHE_ARTIFACT.split('/'));
  const previousIndex = readOptionalFile(rootState, indexFile);
  if (!previousIndex.ok) return previousIndex;
  const previousCache = readOptionalFile(rootState, cacheFile);
  if (!previousCache.ok) return previousCache;

  const indexWrite = writeJsonAtomic(rootState, indexFile, index);
  if (!indexWrite.ok) return indexWrite;

  const currentRaw = readRaw(root, rootState);
  if (!currentRaw.ok) {
    return withRollback(currentRaw, [
      restorePublication({
        rootState,
        file: indexFile,
        previous: previousIndex,
        sourceDigest: index.source_digest
      })
    ]);
  }
  const currentDigest = sha256(currentRaw.bytes);
  if (currentDigest !== index.source_digest) {
    const mismatch = blocked(
      'verification-evidence:index-source-digest-mismatch',
      INDEX_ARTIFACT,
      `${index.source_digest}:${currentDigest}`
    );
    return withRollback(mismatch, [
      restorePublication({
        rootState,
        file: indexFile,
        previous: previousIndex,
        sourceDigest: index.source_digest
      })
    ]);
  }

  const cacheWrite = writeJsonAtomic(
    rootState,
    cacheFile,
    cache
  );
  if (!cacheWrite.ok) {
    return withRollback(cacheWrite, [
      restorePublication({
        rootState,
        file: indexFile,
        previous: previousIndex,
        sourceDigest: index.source_digest
      })
    ], { attempted_index: index });
  }

  const finalRaw = readRaw(root, rootState);
  if (!finalRaw.ok) {
    return withRollback(finalRaw, [
      restorePublication({
        rootState,
        file: indexFile,
        previous: previousIndex,
        sourceDigest: index.source_digest
      }),
      restorePublication({
        rootState,
        file: cacheFile,
        previous: previousCache,
        sourceDigest: index.source_digest
      })
    ]);
  }
  const finalDigest = sha256(finalRaw.bytes);
  if (finalDigest !== index.source_digest) {
    const mismatch = blocked(
      'verification-evidence:index-source-digest-mismatch',
      INDEX_ARTIFACT,
      `${index.source_digest}:${finalDigest}`
    );
    return withRollback(mismatch, [
      restorePublication({
        rootState,
        file: indexFile,
        previous: previousIndex,
        sourceDigest: index.source_digest
      }),
      restorePublication({
        rootState,
        file: cacheFile,
        previous: previousCache,
        sourceDigest: index.source_digest
      })
    ]);
  }

  return {
    ok: true,
    index: Object.freeze(structuredClone(index)),
    cache: Object.freeze(structuredClone(cache)),
    blockers: []
  };
}

module.exports = {
  RAW_ARTIFACT,
  INDEX_ARTIFACT,
  CACHE_ARTIFACT,
  validateRecords,
  readOptionalFile,
  writeBufferAtomic,
  writeJsonAtomic,
  restorePublication,
  rebuildEvidenceIndex
};
