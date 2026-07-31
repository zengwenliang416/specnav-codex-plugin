'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures'
);

const kernelPublic = require(path.join(
  ROOT,
  'plugins/specnav-verification'
));
const evidenceModule = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/evidence'
));
const {
  readySchemaRegistry
} = require(path.join(
  ROOT,
  'tests/verification-v2/contracts/cross-reference/test-helpers'
));

function readFixture(relativePath) {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, relativePath),
    'utf8'
  ));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function makeSandbox(prefix = 'specnav-evidence-integrity-') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const changeRoot = path.join(
    projectRoot,
    'openspec',
    'changes',
    'verification-2-0'
  );
  const sourceRoot = path.join(projectRoot, 'artifacts');
  const storeRoot = path.join(changeRoot, 'verify', 'evidence');
  fs.mkdirSync(changeRoot, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  return { projectRoot, changeRoot, sourceRoot, storeRoot };
}

function makeEvidenceStore(sandbox = makeSandbox()) {
  const schemaRegistry = readySchemaRegistry();
  const store = evidenceModule.createEvidenceStore({
    root: sandbox.storeRoot,
    changeRoot: sandbox.changeRoot,
    changeId: 'change-v2',
    sourceRoot: sandbox.sourceRoot,
    schemaRegistry,
    clock: () => '2026-07-31T00:00:02Z'
  });
  return {
    ...sandbox,
    schemaRegistry,
    store
  };
}

function evidenceCandidate(overrides = {}) {
  return {
    kind: 'structured_comparison',
    producer: 'command-runner',
    captured_at: '2026-07-31T00:00:01Z',
    change_id: 'change-v2',
    run_id: 'run-minimal',
    case_id: 'case-minimal',
    attempt_id: 'attempt-minimal',
    step_id: 'step-1',
    code_sha: '1111111111111111111111111111111111111111',
    test_sha: '2222222222222222222222222222222222222222',
    environment_hash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    content_type: 'application/json',
    ...overrides
  };
}

function baseGraph(storedEvidence) {
  const caseSnapshot = readFixture('positive/case-snapshot.json');
  const run = readFixture('positive/verification-run.json');
  const attempt = readFixture('positive/attempt.json');
  const reading = readFixture('positive/reading.json');
  reading.evidence_ids = [storedEvidence.id];
  return {
    activeChangeId: 'change-v2',
    caseSnapshot,
    run,
    attempts: [attempt],
    readings: [reading],
    evidence: [clone(storedEvidence)]
  };
}

function currentFingerprints(graph) {
  return {
    case_snapshot_hash: graph.run.case_snapshot_hash,
    code_sha: graph.run.code_sha,
    test_sha: graph.run.test_sha,
    environment_hash: graph.run.environment_hash,
    runtime_version: graph.run.runtime_version,
    kernel_version: graph.run.kernel_version
  };
}

function appendStoredEvidence(options = {}) {
  const sandbox = options.sandbox || makeEvidenceStore();
  const content = Buffer.isBuffer(options.content)
    ? Buffer.from(options.content)
    : Buffer.from(options.content || '{"actual":true,"expected":true}\n');
  const appended = sandbox.store.append({
    evidence: evidenceCandidate(options.evidenceOverrides),
    content
  });
  assert.equal(appended.ok, true, JSON.stringify(appended.blockers));
  return {
    ...sandbox,
    content,
    storedEvidence: appended.evidence,
    objectPath: path.join(sandbox.storeRoot, appended.evidence.path),
    graph: baseGraph(appended.evidence),
    currentFingerprints: currentFingerprints(baseGraph(appended.evidence))
  };
}

function createCrossReferenceSpy(result = { ok: true, blockers: [] }) {
  return {
    calls: [],
    validateCrossReferences(graph) {
      this.calls.push(clone(graph));
      return clone(result);
    }
  };
}

function requireFactory() {
  assert.equal(
    typeof evidenceModule.createEvidenceIntegrityChecker,
    'function',
    'Task 013 RED: createEvidenceIntegrityChecker API is unavailable from kernel/evidence'
  );
  assert.equal(
    typeof kernelPublic.createEvidenceIntegrityChecker,
    'function',
    'Task 013 RED: createEvidenceIntegrityChecker API is unavailable from the public kernel entry'
  );
  return evidenceModule.createEvidenceIntegrityChecker;
}

function createChecker(options = {}) {
  const factory = requireFactory();
  const checker = factory({
    evidenceStore: options.evidenceStore,
    crossReferenceValidator: options.crossReferenceValidator,
    registeredProducers: options.registeredProducers || [
      'command-runner',
      'playwright-runner',
      'midscene-runner',
      'human-signoff'
    ],
    clock: options.clock || (() => '2026-07-31T00:00:03Z')
  });
  assert.equal(
    typeof checker?.checkIntegrity,
    'function',
    'Task 013 RED: checkIntegrity API is unavailable'
  );
  return checker;
}

function cleanupSandbox(sandbox) {
  if (!sandbox?.projectRoot) return;
  fs.rmSync(sandbox.projectRoot, { recursive: true, force: true });
}

module.exports = {
  ROOT,
  appendStoredEvidence,
  cleanupSandbox,
  clone,
  createChecker,
  createCrossReferenceSpy,
  currentFingerprints,
  makeEvidenceStore,
  readFixture,
  sha256
};
