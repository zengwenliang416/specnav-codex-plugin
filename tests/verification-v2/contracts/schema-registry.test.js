'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const metadata = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/metadata'
));
const { loadRuntimeLock } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/lock-manifest'
));
const {
  doctorRuntime
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/doctor'
));
const {
  runtimeBaseDefault
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/installer'
));
const {
  ENTITY_TYPES,
  createSchemaRegistry
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/contracts/schema-registry'
));

const FIXTURE_ROOT = path.join(__dirname, 'fixtures');
const SCHEMA_ROOT = path.join(
  ROOT,
  'plugins/specnav-verification/schemas'
);

function environment() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    kernel: {
      name: metadata.name,
      version: metadata.version,
      apiVersion: metadata.apiVersion,
      contractVersion: metadata.contractVersion,
      contractDigest: metadata.contractDigest
    }
  };
}

function readyRuntime() {
  const lock = loadRuntimeLock();
  const status = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    requiresMidscene: false,
    runtimeBase: runtimeBaseDefault()
  });
  assert.equal(status.ok, true, JSON.stringify(status.blockers));
  return status;
}

function fixtureManifest() {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, 'manifest.json'),
    'utf8'
  ));
}

test('registry compiles and validates every Verification Contract V2 entity', () => {
  const runtimeStatus = readyRuntime();
  const registry = createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root,
    schemaRoot: SCHEMA_ROOT
  });
  const expectedTypes = [
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
    'runtime-status',
    'report-model',
    'gate-decision',
    'migration-receipt'
  ];
  assert.deepEqual(ENTITY_TYPES, expectedTypes);
  assert.deepEqual(registry.list(), expectedTypes);

  const manifest = fixtureManifest();
  assert.equal(manifest.positive.length, expectedTypes.length);
  for (const fixture of manifest.positive) {
    const result = registry.validateFile(
      fixture.entity_type,
      path.join(FIXTURE_ROOT, fixture.file)
    );
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.entity_type, fixture.entity_type);
    assert.match(
      result.schema_id,
      /^https:\/\/specnav\.dev\/schemas\/verification\/v2\//
    );
    assert.equal(result.schema_version, 'v1');
    assert.equal(Object.isFrozen(result.value), true);
  }
});

test('negative fixture corpus returns exact artifact and field blockers', () => {
  const runtimeStatus = readyRuntime();
  const registry = createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root,
    schemaRoot: SCHEMA_ROOT
  });
  const manifest = fixtureManifest();
  assert.equal(manifest.negative.length > ENTITY_TYPES.length, true);

  for (const fixture of manifest.negative) {
    const file = path.join(FIXTURE_ROOT, fixture.file);
    const result = registry.validateFile(fixture.entity_type, file);
    assert.equal(result.ok, false, fixture.file);
    assert.equal(result.blockers.length > 0, true, fixture.file);
    assert.equal(
      result.blockers.every((entry) => (
        entry.id === 'verification-contract:schema-invalid'
        && entry.artifact_path === file
        && typeof entry.field === 'string'
        && entry.field.startsWith('/')
      )),
      true,
      JSON.stringify(result.blockers)
    );
    assert.equal(
      result.blockers.some((entry) => entry.field === fixture.expected_field),
      true,
      JSON.stringify(result.blockers)
    );
  }
});

test('evidence and gate schemas directly enforce AC-31 and AC-35 fields', () => {
  const runtimeStatus = readyRuntime();
  const registry = createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root,
    schemaRoot: SCHEMA_ROOT
  });
  const manifest = fixtureManifest();
  const evidence = JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, manifest.ac31_fixture),
    'utf8'
  ));
  const gate = JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, manifest.ac35_fixture),
    'utf8'
  ));

  for (const field of manifest.ac31_required_fields) {
    const invalid = structuredClone(evidence);
    delete invalid[field];
    const result = registry.validate('evidence', invalid, {
      artifactPath: `memory://evidence/missing-${field}`
    });
    assert.equal(result.ok, false, field);
    assert.equal(
      result.blockers.some((entry) => entry.field === `/${field}`),
      true,
      JSON.stringify(result.blockers)
    );
  }
  for (const field of manifest.ac35_required_fields) {
    const invalid = structuredClone(gate);
    delete invalid[field];
    const result = registry.validate('gate-decision', invalid, {
      artifactPath: `memory://gate/missing-${field}`
    });
    assert.equal(result.ok, false, field);
    assert.equal(
      result.blockers.some((entry) => entry.field === `/${field}`),
      true,
      JSON.stringify(result.blockers)
    );
  }
});

test('registry requires doctor-approved managed AJV and never mutates input', () => {
  assert.throws(
    () => createSchemaRegistry({
      runtimeStatus: {
        ok: false,
        readiness: 'blocked',
        blockers: [{ id: 'verification-runtime:runtime-missing' }]
      },
      runtimeRoot: '/missing',
      schemaRoot: SCHEMA_ROOT
    }),
    /verification-contract:runtime-not-ready/
  );

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-schema-runtime-'));
  try {
    assert.throws(
      () => createSchemaRegistry({
        runtimeStatus: {
          ok: true,
          readiness: 'ready',
          runtime_root: sandbox
        },
        runtimeRoot: sandbox,
        schemaRoot: SCHEMA_ROOT
      }),
      /verification-contract:managed-ajv-unavailable/
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  const runtimeStatus = readyRuntime();
  const registry = createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root,
    schemaRoot: SCHEMA_ROOT
  });
  const manifest = fixtureManifest();
  const fixture = JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, manifest.positive[0].file),
    'utf8'
  ));
  const before = JSON.stringify(fixture);
  const result = registry.validate(manifest.positive[0].entity_type, fixture, {
    artifactPath: 'memory://immutable-input'
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(fixture), before);
  assert.notEqual(result.value, fixture);
});

test('shape-valid unresolved references remain Task 004 responsibility', () => {
  const runtimeStatus = readyRuntime();
  const registry = createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root,
    schemaRoot: SCHEMA_ROOT
  });
  const manifest = fixtureManifest();
  const unresolved = JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, manifest.unresolved_reference_fixture),
    'utf8'
  ));
  const result = registry.validate('attempt', unresolved, {
    artifactPath: 'memory://attempt/unresolved-references'
  });
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
});
