#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  createCrossReferenceValidator
} = require('../kernel/contracts/cross-reference-validator');
const {
  createSchemaRegistry
} = require('../kernel/contracts/schema-registry');
const {
  createEvidenceIntegrityChecker,
  createEvidenceStore,
  createV1ToV2Migrator
} = require('../kernel');
const { doctorRuntime } = require('../kernel/runtime/doctor');
const {
  resolveSelectedRuntimeBase
} = require('../kernel/runtime/scope-resolver');
const {
  loadRuntimeLock
} = require('../kernel/runtime/lock-manifest');
const { currentEnvironment } = require('./verification-runtime');

function argValue(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : null;
}

function blocked(id, artifact = 'migration-cli', detail = null) {
  return {
    ok: false,
    blockers: [{ id, artifact, detail }],
    fallback_used: false
  };
}

function readRequest(file) {
  if (!file) return blocked(
    'verification-migration:request-file-missing',
    'request'
  );
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')),
      blockers: []
    };
  } catch (error) {
    return blocked(
      'verification-migration:request-file-invalid',
      file,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function readySchemaRegistry() {
  const lock = loadRuntimeLock();
  const runtimeSelection = resolveSelectedRuntimeBase({
    projectRoot: process.cwd(),
    runtimeVersion: lock.runtime_version
  });
  const runtimeStatus = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: currentEnvironment(),
    providerEnvironment: {},
    requiresMidscene: false,
    runtimeBase: runtimeSelection.runtime_base
  });
  if (!runtimeStatus.ok) {
    const error = new Error('verification-migration:runtime-not-ready');
    error.blockers = runtimeStatus.blockers;
    throw error;
  }
  return createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root
  });
}

function createIntegrityChecker(request, schemaRegistry) {
  const integrity = request.integrity;
  if (
    !integrity
    || typeof integrity.evidence_store_root !== 'string'
    || typeof integrity.source_root !== 'string'
    || !Array.isArray(integrity.registered_producers)
    || integrity.registered_producers.length === 0
  ) {
    throw new Error(
      'verification-migration:integrity-configuration-required'
    );
  }
  const evidenceStore = createEvidenceStore({
    root: path.resolve(integrity.evidence_store_root),
    changeRoot: path.resolve(request.change_root),
    changeId: request.change_id,
    sourceRoot: path.resolve(integrity.source_root),
    schemaRegistry
  });
  const crossReferenceValidator = createCrossReferenceValidator({
    schemaRegistry
  });
  return createEvidenceIntegrityChecker({
    evidenceStore,
    crossReferenceValidator,
    registeredProducers: integrity.registered_producers
  });
}

function run(args = process.argv.slice(2), dependencies = {}) {
  const action = args[0];
  const mode = {
    'dry-run': 'dry_run',
    apply: 'apply',
    rollback: 'rollback'
  }[action];
  if (!mode) {
    return blocked(
      `verification-migration:unsupported-action:${action || '<missing>'}`,
      'action'
    );
  }
  const loaded = readRequest(argValue(args, '--request'));
  if (!loaded.ok) return loaded;
  try {
    const schemaRegistry = dependencies.schemaRegistry
      || readySchemaRegistry();
    const integrityChecker = mode === 'rollback'
      ? dependencies.integrityChecker
      : dependencies.integrityChecker
        || createIntegrityChecker(loaded.value, schemaRegistry);
    const migrator = (dependencies.createMigrator
      || createV1ToV2Migrator)({
      integrityChecker,
      schemaRegistry
    });
    const result = migrator.migrate({
      ...loaded.value,
      mode
    });
    return {
      ...result,
      fallback_used: false
    };
  } catch (error) {
    return {
      ok: false,
      blockers: Array.isArray(error.blockers)
        ? error.blockers
        : [{
            id: error instanceof Error ? error.message : String(error),
            artifact: 'migration-cli',
            detail: null
          }],
      fallback_used: false
    };
  }
}

function main() {
  const result = run();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  argValue,
  createIntegrityChecker,
  main,
  readRequest,
  readySchemaRegistry,
  run
};
