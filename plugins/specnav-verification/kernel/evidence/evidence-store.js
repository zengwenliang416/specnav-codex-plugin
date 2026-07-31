'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { evidenceId, canonicalJson, sha256 } = require('./identity');
const {
  isContained,
  validateStoreRoot,
  validateSourcePath,
  validateResolvedStorePath,
  readStoreFile
} = require('./paths');
const {
  readRaw,
  existingById,
  appendRaw
} = require('./raw-store');
const {
  writeContentAddressed,
  objectRelativePath
} = require('./content-addressed-writer');
const {
  validateRecords,
  INDEX_ARTIFACT,
  rebuildEvidenceIndex
} = require('./index-builder');
const { blocked } = require('./blockers');

const MANAGED_FIELDS = Object.freeze(['id', 'path', 'sha256', 'size']);

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value, seen = new WeakSet()) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, seen));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.keys(value).every((key) => isJsonValue(value[key], seen));
}

function cloneJsonCandidate(value) {
  try {
    if (!isObject(value) || !isJsonValue(value)) {
      return blocked(
        'verification-evidence:candidate-invalid',
        'candidate.evidence'
      );
    }
    const text = JSON.stringify(value);
    if (typeof text !== 'string') {
      return blocked(
        'verification-evidence:candidate-invalid',
        'candidate.evidence'
      );
    }
    const clone = JSON.parse(text);
    if (
      canonicalJson(clone) !== canonicalJson(value)
      || Object.keys(clone).length !== Object.keys(value).length
    ) {
      return blocked(
        'verification-evidence:candidate-invalid',
        'candidate.evidence'
      );
    }
    return { ok: true, value: clone, blockers: [] };
  } catch {
    return blocked(
      'verification-evidence:candidate-invalid',
      'candidate.evidence'
    );
  }
}

function normalizeBytes(request, sourceRoot) {
  const hasContent = Object.prototype.hasOwnProperty.call(request, 'content');
  const hasSource = Object.prototype.hasOwnProperty.call(request, 'source_path');
  if (hasContent === hasSource) {
    return blocked(
      'verification-evidence:candidate-source-ambiguous',
      'candidate'
    );
  }
  if (hasContent) {
    const value = request.content;
    if (
      typeof value !== 'string'
      && !Buffer.isBuffer(value)
      && !(value instanceof Uint8Array)
    ) {
      return blocked(
        'verification-evidence:candidate-invalid',
        'candidate.content'
      );
    }
    return {
      ok: true,
      bytes: Buffer.isBuffer(value)
        ? Buffer.from(value)
        : Buffer.from(value),
      blockers: []
    };
  }

  const source = validateSourcePath(sourceRoot, request.source_path);
  if (!source.ok) {
    return blocked(source.id, request.source_path || 'candidate.source_path');
  }
  try {
    return {
      ok: true,
      bytes: fs.readFileSync(source.realpath),
      blockers: []
    };
  } catch (error) {
    return blocked(
      'verification-evidence:source-read-failed',
      request.source_path,
      `${error?.code || 'ERROR'}: ${
        error instanceof Error ? error.message : String(error)
      }; target=${request.source_path}`
    );
  }
}

function validateConfiguration(options) {
  if (
    !options
    || typeof options !== 'object'
    || typeof options.changeId !== 'string'
    || !options.changeId
    || !options.schemaRegistry
    || typeof options.schemaRegistry.validate !== 'function'
  ) {
    return {
      ok: false,
      id: 'verification-evidence:store-config-invalid'
    };
  }
  const rootState = validateStoreRoot(options.changeRoot, options.root);
  if (!rootState.ok) return rootState;
  if (
    typeof options.sourceRoot !== 'string'
    || !fs.existsSync(options.sourceRoot)
  ) {
    return {
      ok: false,
      id: 'verification-evidence:source-root-missing'
    };
  }
  return {
    ok: true,
    rootState,
    root: rootState.root,
    changeId: options.changeId,
    sourceRoot: path.resolve(options.sourceRoot),
    schemaRegistry: options.schemaRegistry,
    clock: typeof options.clock === 'function'
      ? options.clock
      : () => new Date().toISOString()
  };
}

function managedFieldBlocker(evidence) {
  const supplied = MANAGED_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(evidence, field)
  ));
  return supplied.length > 0
    ? blocked(
        'verification-evidence:managed-field-supplied',
        'candidate.evidence',
        supplied.sort().join(',')
      )
    : null;
}

function createEvidenceStore(options) {
  const config = validateConfiguration(options);

  function configurationFailure() {
    return config.ok
      ? null
      : blocked(config.id, options?.root || 'evidence-store');
  }

  function rebuildIndex() {
    const failed = configurationFailure();
    if (failed) return failed;
    return rebuildEvidenceIndex({
      root: config.root,
      rootState: config.rootState,
      changeId: config.changeId,
      schemaRegistry: config.schemaRegistry,
      clock: config.clock
    });
  }

  function append(request) {
    const failed = configurationFailure();
    if (failed) return failed;
    if (!isObject(request)) {
      return blocked(
        'verification-evidence:candidate-invalid',
        'candidate'
      );
    }
    let evidence;
    try {
      evidence = request.evidence;
    } catch {
      return blocked(
        'verification-evidence:candidate-invalid',
        'candidate.evidence'
      );
    }
    const candidate = cloneJsonCandidate(evidence);
    if (!candidate.ok) return candidate;
    const managed = managedFieldBlocker(candidate.value);
    if (managed) return managed;
    if (candidate.value.change_id !== config.changeId) {
      return blocked(
        'verification-evidence:change-id-mismatch',
        'candidate.evidence.change_id',
        candidate.value.change_id || null
      );
    }
    const content = normalizeBytes(request, config.sourceRoot);
    if (!content.ok) return content;

    const digest = sha256(content.bytes);
    const relativePath = objectRelativePath(
      digest,
      candidate.value.content_type
    );
    const identity = {
      ...candidate.value,
      sha256: digest,
      size: content.bytes.length
    };
    const record = {
      schema: 'specnav.verification.evidence.v1',
      id: evidenceId(identity),
      ...candidate.value,
      path: relativePath,
      sha256: digest,
      size: content.bytes.length
    };
    const validation = config.schemaRegistry.validate('evidence', record, {
      artifactPath: 'memory://evidence-candidate'
    });
    if (!validation.ok) {
      return {
        ok: false,
        blockers: validation.blockers
      };
    }

    const current = readRaw(config.root, config.rootState);
    if (!current.ok) return current;
    const rawValidation = validateRecords(
      current.records,
      config.schemaRegistry
    );
    if (!rawValidation.ok) return rawValidation;
    const existing = existingById(current.records, record.id);
    if (existing && canonicalJson(existing) !== canonicalJson(record)) {
      return blocked(
        'verification-evidence:evidence-id-conflict',
        'raw.jsonl',
        record.id
      );
    }

    const objectWrite = writeContentAddressed({
      root: config.root,
      rootState: config.rootState,
      bytes: content.bytes,
      contentType: candidate.value.content_type
    });
    if (!objectWrite.ok) return objectWrite;
    if (existing) {
      const rebuilt = rebuildIndex();
      if (!rebuilt.ok) {
        return {
          ...rebuilt,
          evidence: Object.freeze(structuredClone(existing)),
          raw_preserved: true
        };
      }
      return {
        ok: true,
        idempotent: true,
        evidence: Object.freeze(structuredClone(existing)),
        index: rebuilt.index,
        blockers: []
      };
    }

    const rawAppend = appendRaw({
      root: config.root,
      rootState: config.rootState,
      record
    });
    if (!rawAppend.ok) {
      return {
        ...rawAppend,
        orphan_object: objectWrite.path
      };
    }
    if (rawAppend.idempotent) {
      return {
        ok: true,
        idempotent: true,
        evidence: Object.freeze(structuredClone(rawAppend.record)),
        blockers: []
      };
    }

    const rebuilt = rebuildIndex();
    if (!rebuilt.ok) {
      return {
        ...rebuilt,
        evidence: Object.freeze(structuredClone(record)),
        raw_preserved: true
      };
    }
    return {
      ok: true,
      idempotent: false,
      evidence: Object.freeze(structuredClone(record)),
      index: rebuilt.index,
      blockers: []
    };
  }

  function getById(id) {
    const failed = configurationFailure();
    if (failed) return failed;
    if (typeof id !== 'string' || !id) {
      return blocked(
        'verification-evidence:evidence-id-invalid',
        'evidence_id'
      );
    }
    const raw = readRaw(config.root, config.rootState);
    if (!raw.ok) return raw;
    if (raw.missing) {
      return blocked(
        'verification-evidence:raw-missing',
        'raw.jsonl'
      );
    }
    const validation = validateRecords(raw.records, config.schemaRegistry);
    if (!validation.ok) return validation;
    const indexFile = path.join(config.root, INDEX_ARTIFACT);
    const indexRead = readStoreFile(
      config.rootState,
      config.root,
      indexFile
    );
    if (!indexRead.ok) {
      if (
        indexRead.id === 'verification-evidence:store-root-invalid'
        || indexRead.id === 'verification-evidence:store-root-outside-change'
        || indexRead.id === 'verification-evidence:store-root-symlink'
        || indexRead.id === 'verification-evidence:change-root-missing'
      ) {
        return blocked(indexRead.id, INDEX_ARTIFACT);
      }
      return blocked(
        indexRead.id === 'verification-evidence:store-file-path-unsafe'
          ? 'verification-evidence:derived-path-unsafe'
          : 'verification-evidence:index-read-failed',
        INDEX_ARTIFACT,
        indexRead.error
          ? `${indexRead.error?.code || 'ERROR'}: ${
              indexRead.error instanceof Error
                ? indexRead.error.message
                : String(indexRead.error)
            }; target=${indexFile}`
          : null
      );
    }
    if (indexRead.missing) {
      return blocked(
        'verification-evidence:index-missing',
        INDEX_ARTIFACT
      );
    }
    let index;
    try {
      index = JSON.parse(indexRead.bytes.toString('utf8'));
    } catch (error) {
      return blocked(
        'verification-evidence:index-read-failed',
        INDEX_ARTIFACT,
        `${error?.code || 'ERROR'}: ${
          error instanceof Error ? error.message : String(error)
        }; target=${indexFile}`
      );
    }
    const indexValidation = config.schemaRegistry.validate(
      'evidence-index',
      index,
      { artifactPath: INDEX_ARTIFACT }
    );
    if (!indexValidation.ok) {
      return {
        ok: false,
        blockers: indexValidation.blockers
      };
    }
    const currentDigest = sha256(raw.bytes);
    if (index.source_digest !== currentDigest) {
      return blocked(
        'verification-evidence:index-source-digest-mismatch',
        INDEX_ARTIFACT,
        `${index.source_digest}:${currentDigest}`
      );
    }
    const evidence = existingById(index.entries, id);
    if (!evidence) {
      return blocked(
        'verification-evidence:evidence-not-found',
        'evidence_id',
        id
      );
    }
    return {
      ok: true,
      evidence: Object.freeze(structuredClone(evidence)),
      blockers: []
    };
  }

  function resolve(id) {
    const found = getById(id);
    if (!found.ok) return found;
    const absolute = path.resolve(
      config.root,
      ...found.evidence.path.split('/')
    );
    if (!isContained(config.root, absolute)) {
      return blocked(
        'verification-evidence:object-path-unsafe',
        found.evidence.path
      );
    }
    const resolvedPath = validateResolvedStorePath(
      config.rootState,
      config.root,
      absolute
    );
    if (!resolvedPath.ok) {
      return blocked(resolvedPath.id, found.evidence.path);
    }
    if (fs.existsSync(absolute)) {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return blocked(
          'verification-evidence:object-path-unsafe',
          found.evidence.path
        );
      }
    }
    return {
      ok: true,
      evidence: found.evidence,
      path: absolute,
      pathPolicy: Object.freeze({
        root: config.root,
        rootState: Object.freeze(structuredClone(config.rootState))
      }),
      blockers: []
    };
  }

  return Object.freeze({
    append,
    rebuildIndex,
    getById,
    resolve
  });
}

module.exports = {
  MANAGED_FIELDS,
  isJsonValue,
  cloneJsonCandidate,
  normalizeBytes,
  validateConfiguration,
  createEvidenceStore
};
