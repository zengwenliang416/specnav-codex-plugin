'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  artifactRef,
  backupManifest,
  blocker,
  canonicalDirectory,
  readRegularFile,
  resolveContained,
  sha256,
  sourceArtifact,
  writeBackup,
  writeExclusive
} = require('./artifact-backup');
const {
  createTransformationRegistry
} = require('./transformation-registry');

const MODES = new Set(['dry_run', 'apply', 'rollback']);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function failed(blockers, extra = {}) {
  return {
    ok: false,
    blockers: Array.isArray(blockers) ? blockers : [blockers],
    fallback_used: false,
    ...extra
  };
}

function receiptValidation(schemaRegistry, receipt) {
  const result = schemaRegistry.validate('migration-receipt', receipt, {
    artifactPath: `migration://${receipt.id}/receipt`
  });
  return result?.ok
    ? { ok: true, blockers: [] }
    : {
        ok: false,
        blockers: [blocker(
          'verification-migration:receipt-schema-invalid',
          receipt.id,
          JSON.stringify(result?.blockers || [])
        )]
      };
}

function parseSource(source) {
  try {
    return { ok: true, value: JSON.parse(source.bytes.toString('utf8')) };
  } catch (error) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-migration:legacy-json-invalid',
        source.relativePath,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
}

function migrationPaths(migrationId) {
  return {
    backupDir: path.posix.join(
      'verify',
      'migration',
      'backups',
      migrationId
    ),
    backupManifest: path.posix.join(
      'verify',
      'migration',
      'backups',
      migrationId,
      'manifest.json'
    ),
    runDir: path.posix.join(
      'verify',
      'migration',
      'runs',
      migrationId
    ),
    readings: path.posix.join(
      'verify',
      'migration',
      'runs',
      migrationId,
      'readings.jsonl'
    ),
    receipt: path.posix.join(
      'verify',
      'migration',
      'receipts',
      `${migrationId}.json`
    ),
    rollbackReceipt: path.posix.join(
      'verify',
      'migration',
      'receipts',
      `${migrationId}-rollback.json`
    )
  };
}

function targetExists(changeRoot, paths) {
  for (const relativePath of [
    paths.backupDir,
    paths.runDir,
    paths.receipt
  ]) {
    const resolved = resolveContained(changeRoot, relativePath);
    if (!resolved.ok) return resolved;
    if (fs.existsSync(resolved.target)) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-migration:target-exists',
          relativePath
        )]
      };
    }
  }
  return { ok: true, blockers: [] };
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return failed(blocker(
      'verification-migration:request-invalid',
      'migration-request'
    ));
  }
  if (!MODES.has(request.mode)) {
    return failed(blocker(
      'verification-migration:mode-invalid',
      request.mode || '<missing>'
    ));
  }
  if (!STABLE_ID.test(request.change_id || '')) {
    return failed(blocker(
      'verification-migration:change-id-invalid',
      request.change_id || '<missing>'
    ));
  }
  if (!STABLE_ID.test(request.migration_id || '')) {
    return failed(blocker(
      'verification-migration:migration-id-invalid',
      request.migration_id || '<missing>'
    ));
  }
  if (
    typeof request.change_root !== 'string'
    || request.change_root.length === 0
  ) {
    return failed(blocker(
      'verification-migration:change-root-invalid',
      request.change_root || '<missing>'
    ));
  }
  const root = canonicalDirectory(
    request.change_root,
    'verification-migration:change-root-invalid'
  );
  if (!root.ok) return failed(root.blockers);
  if (
    request.mode !== 'rollback'
    && (
      !Array.isArray(request.artifacts)
      || request.artifacts.length === 0
    )
  ) {
    return failed(blocker(
      'verification-migration:artifacts-missing',
      'artifacts'
    ));
  }
  return {
    ok: true,
    request: structuredClone(request),
    changeRoot: root.root,
    blockers: []
  };
}

function buildReceipt(options) {
  const {
    mode,
    status,
    migrationId,
    changeId,
    timestamp,
    backupRef,
    transformedArtifacts,
    validatedEntities,
    validationBlockers = [],
    rollbackAvailable,
    rollbackInstructions,
    rollbackReceiptRef
  } = options;
  return {
    schema: 'specnav.verification.migration-receipt.v1',
    id: mode === 'rollback'
      ? `${migrationId}-rollback`
      : migrationId,
    change_id: changeId,
    from_version: 'v1',
    to_version: 'v2',
    mode,
    status,
    started_at: timestamp,
    completed_at: timestamp,
    backup_ref: backupRef,
    transformed_artifacts: transformedArtifacts,
    validation: {
      ok: validationBlockers.length === 0,
      validated_entities: [...new Set(validatedEntities)].sort(),
      blockers: validationBlockers
    },
    rollback: {
      available: rollbackAvailable,
      instructions: rollbackInstructions,
      receipt_ref: rollbackReceiptRef
    },
    fallback_used: false
  };
}

function buildPlan(options) {
  const {
    request,
    changeRoot,
    clock,
    registry,
    schemaRegistry
  } = options;
  const paths = migrationPaths(request.migration_id);
  const sources = [];
  const preview = [];
  const sourcePaths = new Set();

  for (const descriptor of request.artifacts) {
    if (sourcePaths.has(descriptor?.path)) {
      return failed(blocker(
        'verification-migration:duplicate-source',
        descriptor.path
      ));
    }
    sourcePaths.add(descriptor?.path);
    const source = sourceArtifact(changeRoot, descriptor);
    if (!source.ok) return failed(source.blockers);
    const parsed = parseSource(source);
    if (!parsed.ok) return failed(parsed.blockers);
    const sourceRef = {
      path: source.relativePath,
      sha256: source.sha256,
      size: source.size
    };
    const transformed = registry.transform({
      source: parsed.value,
      sourceRef,
      migrationId: request.migration_id,
      changeId: request.change_id
    });
    if (!transformed.ok) return failed(transformed.blockers);
    sources.push(source);
    preview.push(transformed.value);
  }
  if (preview.some((entry) => (
    entry?.artifact_kind !== 'verification-migrated-reading'
    || entry?.format_version !== 1
    || !entry.reading
    || typeof entry.requires_rerun !== 'boolean'
    || !Array.isArray(entry.blocker_ids)
  ))) {
    return failed(blocker(
      'verification-migration:projection-invalid',
      request.migration_id
    ));
  }

  const timestamp = clock();
  const manifest = backupManifest(
    request.migration_id,
    timestamp,
    sources
  );
  const manifestBytes = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  const backupRef = artifactRef(
    `${request.migration_id}-backup-manifest`,
    paths.backupManifest,
    manifestBytes
  );
  const readingsBytes = Buffer.from(
    `${preview.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  const readingsRef = artifactRef(
    `${request.migration_id}-readings`,
    paths.readings,
    readingsBytes
  );
  const receipt = buildReceipt({
    mode: request.mode,
    status: request.mode === 'dry_run' ? 'planned' : 'succeeded',
    migrationId: request.migration_id,
    changeId: request.change_id,
    timestamp,
    backupRef,
    transformedArtifacts: [readingsRef],
    validatedEntities: [
      ...preview.map((entry) => `reading:${entry.reading.id}`),
      `migration-receipt:${request.migration_id}`
    ],
    rollbackAvailable: request.mode === 'apply',
    rollbackInstructions: request.mode === 'apply'
      ? `Run rollback with receipt ${paths.receipt}; V1 sources and backup remain immutable.`
      : `Review this dry run, then apply migration ${request.migration_id} to create a rollback receipt.`,
    rollbackReceiptRef: request.mode === 'apply'
      ? { id: request.migration_id, path: paths.receipt }
      : null
  });
  const validatedReceipt = receiptValidation(schemaRegistry, receipt);
  if (!validatedReceipt.ok) return failed(validatedReceipt.blockers);
  return {
    ok: true,
    paths,
    sources,
    preview,
    manifest,
    manifestBytes,
    readingsBytes,
    receipt,
    blockers: []
  };
}

function applyPlan(changeRoot, plan) {
  const targets = targetExists(changeRoot, plan.paths);
  if (!targets.ok) return failed(targets.blockers);
  try {
    const backupRef = writeBackup(
      changeRoot,
      plan.manifest,
      plan.sources
    );
    if (
      backupRef.sha256 !== plan.receipt.backup_ref.sha256
      || backupRef.size !== plan.receipt.backup_ref.size
    ) {
      throw new Error('verification-migration:backup-manifest-mismatch');
    }
    writeExclusive(changeRoot, plan.paths.readings, plan.readingsBytes);
    writeExclusive(
      changeRoot,
      plan.paths.receipt,
      Buffer.from(`${JSON.stringify(plan.receipt, null, 2)}\n`)
    );
    return {
      ok: true,
      receipt: structuredClone(plan.receipt),
      preview: structuredClone(plan.preview),
      blockers: [],
      fallback_used: false
    };
  } catch (error) {
    for (const relativePath of [
      plan.paths.receipt,
      plan.paths.runDir,
      plan.paths.backupDir
    ]) {
      const resolved = resolveContained(changeRoot, relativePath);
      if (resolved.ok) {
        fs.rmSync(resolved.target, { recursive: true, force: true });
      }
    }
    return failed(
      Array.isArray(error.blockers)
        ? error.blockers
        : blocker(
            'verification-migration:apply-write-failed',
            plan.paths.receipt,
            error instanceof Error ? error.message : String(error)
          )
    );
  }
}

function readValidatedReceipt(changeRoot, request, schemaRegistry) {
  const paths = migrationPaths(request.migration_id);
  if (request.receipt_path !== paths.receipt) {
    return failed(blocker(
      'verification-migration:rollback-provenance-invalid',
      request.receipt_path || '<missing>',
      'receipt-path'
    ));
  }
  const resolved = resolveContained(changeRoot, request.receipt_path, {
    mustExist: true,
    pathBlocker: 'verification-migration:receipt-path-unsafe',
    symlinkBlocker: 'verification-migration:receipt-symlink',
    missingBlocker: 'verification-migration:receipt-missing'
  });
  if (!resolved.ok) return failed(resolved.blockers);
  let receipt;
  try {
    receipt = JSON.parse(readRegularFile(resolved.target).toString('utf8'));
  } catch (error) {
    return failed(blocker(
      'verification-migration:receipt-json-invalid',
      request.receipt_path,
      error instanceof Error ? error.message : String(error)
    ));
  }
  const validation = receiptValidation(schemaRegistry, receipt);
  if (!validation.ok) return failed(validation.blockers);
  if (
    receipt.mode !== 'apply'
    || receipt.status !== 'succeeded'
    || receipt.id !== request.migration_id
    || receipt.change_id !== request.change_id
    || receipt.rollback.available !== true
    || receipt.backup_ref.path !== paths.backupManifest
    || receipt.backup_ref.id
      !== `${request.migration_id}-backup-manifest`
    || receipt.transformed_artifacts.length !== 1
    || receipt.transformed_artifacts[0].path !== paths.readings
    || receipt.transformed_artifacts[0].id
      !== `${request.migration_id}-readings`
    || receipt.rollback.receipt_ref?.path !== paths.receipt
    || receipt.rollback.receipt_ref?.id !== request.migration_id
  ) {
    return failed(blocker(
      'verification-migration:rollback-provenance-invalid',
      request.receipt_path,
      'receipt-bindings'
    ));
  }
  return { ok: true, receipt, blockers: [] };
}

function verifyArtifactRef(changeRoot, ref, mismatchId) {
  const resolved = resolveContained(changeRoot, ref.path, {
    mustExist: true,
    pathBlocker: 'verification-migration:rollback-path-unsafe',
    symlinkBlocker: 'verification-migration:rollback-path-symlink',
    missingBlocker: mismatchId
  });
  if (!resolved.ok) return resolved;
  let bytes;
  try {
    bytes = readRegularFile(resolved.target);
  } catch (error) {
    return {
      ok: false,
      blockers: [blocker(
        mismatchId,
        ref.path,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
  if (sha256(bytes) !== ref.sha256 || bytes.length !== ref.size) {
    return {
      ok: false,
      blockers: [blocker(mismatchId, ref.path)]
    };
  }
  return {
    ok: true,
    target: resolved.target,
    bytes,
    blockers: []
  };
}

function rollback(options) {
  const {
    request,
    changeRoot,
    clock,
    schemaRegistry
  } = options;
  if (typeof request.receipt_path !== 'string') {
    return failed(blocker(
      'verification-migration:receipt-path-missing',
      'receipt_path'
    ));
  }
  const loaded = readValidatedReceipt(
    changeRoot,
    request,
    schemaRegistry
  );
  if (!loaded.ok) return loaded;
  const receipt = loaded.receipt;
  const backup = verifyArtifactRef(
    changeRoot,
    receipt.backup_ref,
    'verification-migration:rollback-backup-mismatch'
  );
  if (!backup.ok) return failed(backup.blockers);
  const transformed = [];
  for (const ref of receipt.transformed_artifacts) {
    const verified = verifyArtifactRef(
      changeRoot,
      ref,
      'verification-migration:rollback-artifact-mismatch'
    );
    if (!verified.ok) return failed(verified.blockers);
    transformed.push({
      ref,
      target: verified.target,
      bytes: verified.bytes
    });
  }
  const paths = migrationPaths(request.migration_id);
  const rollbackTarget = resolveContained(
    changeRoot,
    paths.rollbackReceipt
  );
  if (!rollbackTarget.ok) return failed(rollbackTarget.blockers);
  if (fs.existsSync(rollbackTarget.target)) {
    return failed(blocker(
      'verification-migration:target-exists',
      paths.rollbackReceipt
    ));
  }

  const timestamp = clock();
  const rollbackReceipt = buildReceipt({
    mode: 'rollback',
    status: 'rolled_back',
    migrationId: request.migration_id,
    changeId: request.change_id,
    timestamp,
    backupRef: structuredClone(receipt.backup_ref),
    transformedArtifacts: structuredClone(receipt.transformed_artifacts),
    validatedEntities: receipt.transformed_artifacts.map(
      (ref) => `rollback:${ref.id}`
    ),
    rollbackAvailable: false,
    rollbackInstructions:
      'Rollback completed. Original V1 artifacts, backup, and both receipts are retained.',
    rollbackReceiptRef: {
      id: receipt.id,
      path: request.receipt_path
    }
  });
  const validation = receiptValidation(schemaRegistry, rollbackReceipt);
  if (!validation.ok) return failed(validation.blockers);

  const recovery = transformed;
  try {
    for (const entry of transformed) fs.rmSync(entry.target);
    const runDir = path.join(changeRoot, paths.runDir);
    if (
      fs.existsSync(runDir)
      && fs.readdirSync(runDir).length === 0
    ) {
      fs.rmdirSync(runDir);
    }
    writeExclusive(
      changeRoot,
      paths.rollbackReceipt,
      Buffer.from(`${JSON.stringify(rollbackReceipt, null, 2)}\n`)
    );
  } catch (error) {
    let recoveryError = null;
    for (const entry of recovery) {
      try {
        if (!fs.existsSync(entry.target)) {
          writeExclusive(changeRoot, entry.ref.path, entry.bytes);
        }
      } catch (restoreError) {
        recoveryError = restoreError;
      }
    }
    fs.rmSync(rollbackTarget.target, { force: true });
    return failed(blocker(
      recoveryError
        ? 'verification-migration:rollback-recovery-failed'
        : 'verification-migration:rollback-write-failed',
      paths.rollbackReceipt,
      recoveryError
        ? `${error instanceof Error ? error.message : String(error)}; restore: ${
            recoveryError instanceof Error
              ? recoveryError.message
              : String(recoveryError)
          }`
        : error instanceof Error ? error.message : String(error)
    ));
  }
  return {
    ok: true,
    receipt: rollbackReceipt,
    blockers: [],
    fallback_used: false
  };
}

function createV1ToV2Migrator(options = {}) {
  const {
    integrityChecker,
    schemaRegistry,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-migration:config-invalid');
  }

  function migrate(request) {
    const validated = validateRequest(request);
    if (!validated.ok) return validated;
    if (validated.request.mode === 'rollback') {
      return rollback({
        request: validated.request,
        changeRoot: validated.changeRoot,
        clock,
        schemaRegistry
      });
    }
    if (
      !integrityChecker
      || typeof integrityChecker.checkIntegrity !== 'function'
    ) {
      return failed(blocker(
        'verification-migration:integrity-checker-required',
        validated.request.mode
      ));
    }
    const registry = createTransformationRegistry({
      integrityChecker,
      schemaRegistry
    });
    const plan = buildPlan({
      request: validated.request,
      changeRoot: validated.changeRoot,
      clock,
      registry,
      schemaRegistry
    });
    if (!plan.ok) return plan;
    if (validated.request.mode === 'dry_run') {
      return {
        ok: true,
        receipt: structuredClone(plan.receipt),
        preview: structuredClone(plan.preview),
        blockers: [],
        fallback_used: false
      };
    }
    return applyPlan(validated.changeRoot, plan);
  }

  return Object.freeze({ migrate });
}

module.exports = {
  buildReceipt,
  createV1ToV2Migrator,
  migrationPaths
};
