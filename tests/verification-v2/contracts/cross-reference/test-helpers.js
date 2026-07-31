'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures');
const SCHEMA_ROOT = path.join(
  ROOT,
  'plugins/specnav-verification/schemas'
);
const SUBJECT_PATH = path.join(
  ROOT,
  'plugins/specnav-verification/kernel/contracts/cross-reference-validator.js'
);

const metadata = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/metadata'
));
const { loadRuntimeLock } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/lock-manifest'
));
const { doctorRuntime } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/doctor'
));
const { runtimeBaseDefault } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/installer'
));
const { createSchemaRegistry } = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/contracts/schema-registry'
));

let subject = null;
let subjectLoadError = null;
try {
  subject = require(SUBJECT_PATH);
} catch (error) {
  subjectLoadError = error;
}

let cachedSchemaRegistry = null;

function readFixture(relativePath) {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, relativePath),
    'utf8'
  ));
}

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

function readySchemaRegistry() {
  if (cachedSchemaRegistry) return cachedSchemaRegistry;
  const lock = loadRuntimeLock();
  const runtimeStatus = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: environment(),
    providerEnvironment: {},
    requiresMidscene: false,
    runtimeBase: runtimeBaseDefault()
  });
  assert.equal(runtimeStatus.ok, true, JSON.stringify(runtimeStatus.blockers));
  cachedSchemaRegistry = createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root,
    schemaRoot: SCHEMA_ROOT
  });
  return cachedSchemaRegistry;
}

function fixtureGraph() {
  const caseSnapshot = readFixture('positive/case-snapshot.json');
  const run = readFixture('positive/verification-run.json');
  const attempt = readFixture('positive/attempt.json');
  const stepReading = readFixture('positive/reading.json');
  const stepEvidence = readFixture('ac31/evidence-baseline.json');

  // Task 013 owns producer, path, file, bytes, hash, and size checks.
  stepEvidence.path = 'evidence/objects/does-not-exist.log';
  stepEvidence.sha256 = '0'.repeat(64);
  stepEvidence.size = 987654321;
  stepEvidence.producer = 'producer-not-on-any-allowlist';

  const assertionEvidence = structuredClone(stepEvidence);
  assertionEvidence.id = 'evidence-assertion';
  delete assertionEvidence.step_id;
  assertionEvidence.assertion_id = 'assertion-1';

  const assertionReading = structuredClone(stepReading);
  assertionReading.id = 'reading-assertion';
  delete assertionReading.step_id;
  assertionReading.assertion_id = 'assertion-1';
  assertionReading.evidence_ids = [assertionEvidence.id];

  return {
    activeChangeId: 'change-v2',
    caseSnapshot,
    run,
    attempts: [attempt],
    readings: [stepReading, assertionReading],
    evidence: [stepEvidence, assertionEvidence]
  };
}

function requireFactory() {
  if (subjectLoadError) {
    assert.fail(
      `Task 004 RED: cross-reference-validator.js is unavailable: ${subjectLoadError.message}`
    );
  }
  assert.equal(
    typeof subject?.createCrossReferenceValidator,
    'function',
    'Task 004 RED: createCrossReferenceValidator API is unavailable'
  );
  return subject.createCrossReferenceValidator;
}

function createValidator(schemaRegistry = readySchemaRegistry()) {
  const validator = requireFactory()({ schemaRegistry });
  assert.equal(
    typeof validator?.validateCrossReferences,
    'function',
    'Task 004 RED: validateCrossReferences API is unavailable'
  );
  assert.equal(
    typeof validator?.validateRetryIdentity,
    'function',
    'Task 004 RED: validateRetryIdentity API is unavailable'
  );
  return validator;
}

function validateGraph(graph, schemaRegistry) {
  return createValidator(schemaRegistry).validateCrossReferences(graph);
}

function validateRetry(parentAttempt, retryAttempt, schemaRegistry) {
  return createValidator(schemaRegistry).validateRetryIdentity({
    parentAttempt,
    retryAttempt
  });
}

function assertBlocker(result, expected) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(
    result.blockers.some((blocker) => (
      blocker.id === expected.id
      && blocker.entity_type === expected.entityType
      && blocker.entity_id === expected.entityId
      && blocker.field === expected.field
    )),
    true,
    JSON.stringify(result.blockers)
  );
}

function assertCrossReferenceBlocker(result, entityType, entityId, field) {
  assertBlocker(result, {
    id: 'verification-contract:cross-reference-invalid',
    entityType,
    entityId,
    field: `/${field}`
  });
}

function assertReadingEvidenceBlocker(result, readingId, evidenceId) {
  assertCrossReferenceBlocker(
    result,
    'reading',
    readingId,
    'evidence_ids'
  );
  assert.equal(
    result.blockers.some((blocker) => (
      blocker.id === 'verification-contract:cross-reference-invalid'
      && blocker.entity_type === 'reading'
      && blocker.entity_id === readingId
      && blocker.field === '/evidence_ids'
      && blocker.related_entity_type === 'evidence'
      && blocker.related_entity_id === evidenceId
    )),
    true,
    JSON.stringify(result.blockers)
  );
}

function assertRetryBlocker(result, id, field) {
  assertBlocker(result, {
    id,
    entityType: 'attempt',
    entityId: 'attempt-retry',
    field: `/${field}`
  });
}

function changedGraph(mutator) {
  const graph = fixtureGraph();
  mutator(graph);
  return graph;
}

function retryPair() {
  const parentAttempt = {
    ...readFixture('positive/attempt.json'),
    status: 'failed',
    exit_status: 1
  };
  const retryAttempt = {
    ...parentAttempt,
    id: 'attempt-retry',
    kind: 'retry',
    sequence: parentAttempt.sequence + 1,
    parent_attempt_id: parentAttempt.id,
    status: 'passed',
    started_at: '2026-07-31T00:01:00Z',
    completed_at: '2026-07-31T00:01:01Z',
    exit_status: 0
  };
  return { parentAttempt, retryAttempt };
}

function graphWithRetry() {
  const graph = fixtureGraph();
  const { parentAttempt, retryAttempt } = retryPair();
  graph.attempts = [parentAttempt, retryAttempt];
  return graph;
}

module.exports = {
  ROOT,
  assertBlocker,
  assertCrossReferenceBlocker,
  assertReadingEvidenceBlocker,
  assertRetryBlocker,
  changedGraph,
  createValidator,
  fixtureGraph,
  graphWithRetry,
  readySchemaRegistry,
  requireFactory,
  retryPair,
  validateGraph,
  validateRetry
};
