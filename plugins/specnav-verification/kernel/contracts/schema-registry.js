'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ENTITY_TYPES = Object.freeze([
  'test-case',
  'case-approval',
  'case-snapshot',
  'verification-run',
  'attempt',
  'reading',
  'evidence',
  'evidence-index',
  'failure-packet',
  'repair-link',
  'trusted-fact-envelope',
  'transition-proposal',
  'runtime-status',
  'report-model',
  'gate-decision',
  'migration-receipt'
]);

const SCHEMA_REGISTRIES = new WeakSet();

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function readSchema(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fieldForError(error) {
  const base = typeof error.instancePath === 'string' ? error.instancePath : '';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    return `${base}/${error.params.missingProperty}` || '/';
  }
  if (error.keyword === 'additionalProperties' && error.params?.additionalProperty) {
    return `${base}/${error.params.additionalProperty}` || '/';
  }
  return base || '/';
}

function normalizeErrors(errors, artifactPath, entityType) {
  return (Array.isArray(errors) ? errors : [])
    .map((error) => ({
      id: 'verification-contract:schema-invalid',
      artifact_path: artifactPath,
      entity_type: entityType,
      field: fieldForError(error),
      keyword: error.keyword || 'unknown',
      schema_path: error.schemaPath || null,
      message: error.message || 'schema validation failed'
    }))
    .sort((left, right) => (
      left.field.localeCompare(right.field)
      || left.keyword.localeCompare(right.keyword)
      || String(left.schema_path).localeCompare(String(right.schema_path))
    ));
}

function requireManagedAjv(runtimeRoot) {
  try {
    const runtimeRequire = createRequire(path.join(runtimeRoot, 'package.json'));
    const ajvModule = runtimeRequire('ajv/dist/2020');
    const formatsModule = runtimeRequire('ajv-formats');
    return {
      Ajv2020: ajvModule.default || ajvModule,
      addFormats: formatsModule.default || formatsModule
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`verification-contract:managed-ajv-unavailable:${detail}`);
  }
}

function assertManagedRuntime(runtimeStatus, runtimeRoot) {
  if (
    !runtimeStatus
    || runtimeStatus.ok !== true
    || runtimeStatus.readiness !== 'ready'
  ) {
    throw new Error('verification-contract:runtime-not-ready');
  }
  let actualRoot;
  try {
    actualRoot = fs.realpathSync(runtimeRoot);
  } catch {
    throw new Error(`verification-contract:managed-runtime-root-missing:${runtimeRoot}`);
  }
  let reportedRoot;
  try {
    reportedRoot = fs.realpathSync(runtimeStatus.runtime_root);
  } catch {
    throw new Error(
      `verification-contract:doctor-runtime-root-missing:${runtimeStatus.runtime_root || '<missing>'}`
    );
  }
  if (actualRoot !== reportedRoot) {
    throw new Error(
      `verification-contract:runtime-root-mismatch:${reportedRoot}:${actualRoot}`
    );
  }
  return actualRoot;
}

function createSchemaRegistry(options = {}) {
  const {
    runtimeStatus,
    runtimeRoot,
    schemaRoot = path.resolve(__dirname, '../../schemas')
  } = options;
  const managedRuntimeRoot = assertManagedRuntime(runtimeStatus, runtimeRoot);
  const { Ajv2020, addFormats } = requireManagedAjv(managedRuntimeRoot);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false
  });
  addFormats(ajv);

  const schemaFiles = [
    path.join(schemaRoot, 'common.schema.json'),
    ...ENTITY_TYPES.map((entityType) => (
      path.join(schemaRoot, `${entityType}.schema.json`)
    ))
  ];
  const schemas = new Map();
  try {
    for (const file of schemaFiles) {
      const schema = readSchema(file);
      ajv.addSchema(schema);
      if (file.endsWith('common.schema.json')) continue;
      const entityType = path.basename(file, '.schema.json');
      schemas.set(entityType, deepFreeze(schema));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`verification-contract:schema-registry-invalid:${detail}`);
  }

  const validators = new Map();
  for (const entityType of ENTITY_TYPES) {
    const schema = schemas.get(entityType);
    const validator = schema?.$id ? ajv.getSchema(schema.$id) : null;
    if (!validator) {
      throw new Error(`verification-contract:schema-not-compiled:${entityType}`);
    }
    validators.set(entityType, validator);
  }

  function getSchema(entityType) {
    const schema = schemas.get(entityType);
    if (!schema) {
      throw new Error(`verification-contract:unknown-entity-type:${entityType}`);
    }
    return schema;
  }

  function validate(entityType, value, validateOptions = {}) {
    const validator = validators.get(entityType);
    if (!validator) {
      throw new Error(`verification-contract:unknown-entity-type:${entityType}`);
    }
    const artifactPath = validateOptions.artifactPath || `memory://${entityType}`;
    const candidate = clone(value);
    const ok = validator(candidate);
    const schema = getSchema(entityType);
    if (!ok) {
      return {
        ok: false,
        entity_type: entityType,
        schema_id: schema.$id,
        schema_version: 'v1',
        value: null,
        blockers: normalizeErrors(
          validator.errors,
          artifactPath,
          entityType
        )
      };
    }
    return {
      ok: true,
      entity_type: entityType,
      schema_id: schema.$id,
      schema_version: 'v1',
      value: deepFreeze(candidate),
      blockers: []
    };
  }

  function validateFile(entityType, file) {
    const resolved = path.resolve(file);
    let value;
    try {
      value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (error) {
      return {
        ok: false,
        entity_type: entityType,
        schema_id: schemas.get(entityType)?.$id || null,
        schema_version: 'v1',
        value: null,
        blockers: [{
          id: 'verification-contract:artifact-json-invalid',
          artifact_path: resolved,
          entity_type: entityType,
          field: '/',
          keyword: 'parse',
          schema_path: null,
          message: error instanceof Error ? error.message : String(error)
        }]
      };
    }
    return validate(entityType, value, { artifactPath: resolved });
  }

  function assertValid(entityType, value, validateOptions = {}) {
    const result = validate(entityType, value, validateOptions);
    if (!result.ok) {
      const error = new Error(
        `verification-contract:schema-invalid:${entityType}`
      );
      error.blockers = result.blockers;
      throw error;
    }
    return result.value;
  }

  const registry = Object.freeze({
    runtime_root: managedRuntimeRoot,
    list: () => [...ENTITY_TYPES],
    getSchema,
    validate,
    validateFile,
    assertValid
  });
  SCHEMA_REGISTRIES.add(registry);
  return registry;
}

function isSchemaRegistry(value) {
  try {
    return SCHEMA_REGISTRIES.has(value)
      && typeof value.validate === 'function'
      && typeof value.getSchema === 'function'
      && typeof value.assertValid === 'function';
  } catch {
    return false;
  }
}

module.exports = {
  ENTITY_TYPES,
  createSchemaRegistry,
  deepFreeze,
  fieldForError,
  isSchemaRegistry,
  normalizeErrors,
  requireManagedAjv
};
