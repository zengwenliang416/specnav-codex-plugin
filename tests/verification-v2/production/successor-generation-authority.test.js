'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const kernel = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel'
));
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

function clock() {
  let tick = 0;
  return () => new Date(
    Date.UTC(2026, 7, 25, 12, 0, 0, tick++)
  ).toISOString();
}

function state(overrides = {}) {
  return {
    change_id: 'change-generation',
    reviewer_id: 'reviewer-1',
    snapshot_id: 'snapshot-generation',
    snapshot_hash: 'a'.repeat(64),
    parent_generation_id: null,
    fingerprints: {
      case_snapshot_hash: 'a'.repeat(64),
      code_sha: '1'.repeat(40),
      test_sha: '2'.repeat(64),
      environment_hash: '3'.repeat(64),
      runtime_version: '2.0.0',
      kernel_version: '2.0.0'
    },
    historical_break_loop_failure_ids: ['failure-history'],
    collections: {
      runs: [{ id: 'run-history', status: 'failed' }],
      attempts: [{ id: 'attempt-history', status: 'failed' }],
      executions: [{ id: 'execution-history', status: 'failed' }],
      readings: [{ id: 'reading-history', status: 'fail' }],
      failures: [{ id: 'failure-history', status: 'break_loop' }],
      repair_links: [],
      evidence: [{ id: 'evidence-history', result: 'fail' }],
      transition_proposals: [{ id: 'proposal-history' }],
      transition_receipts: [{ id: 'receipt-history' }],
      attempt_facts: [{ id: 'attempt-fact-history' }]
    },
    ...overrides
  };
}

function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-generation-'
  ));
  const changeRoot = path.join(
    projectRoot,
    'openspec',
    'changes',
    'change-generation'
  );
  const verificationRoot = path.join(changeRoot, 'verify');
  fs.mkdirSync(verificationRoot, { recursive: true });
  const schemaRegistry = readySchemaRegistry();
  const authority = kernel.createVerificationGenerationAuthority({
    schemaRegistry,
    key: Buffer.alloc(32, 41),
    clock: clock()
  });
  const store = kernel.createVerificationArtifactStore({
    changeRoot,
    root: verificationRoot
  });
  return { authority, store };
}

test('successor generation requires exact human approval and preserves replay', () => {
  const source = fixture();
  const current = state();
  const prepared = source.authority.prepare(current);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.blockers));

  const denied = source.authority.append(
    source.store,
    prepared.review,
    current,
    false
  );
  assert.equal(denied.ok, false);
  assert.equal(
    denied.blockers[0].id,
    'verification-generation:approval-required'
  );

  const activated = source.authority.append(
    source.store,
    prepared.review,
    current,
    true
  );
  assert.equal(activated.ok, true, JSON.stringify(activated.blockers));
  assert.equal(activated.appended, true);
  assert.equal(
    activated.value.id,
    `generation-${prepared.review.review_sha256.slice(0, 24)}`
  );

  const replay = source.authority.append(
    source.store,
    prepared.review,
    current,
    true
  );
  assert.equal(replay.ok, true, JSON.stringify(replay.blockers));
  assert.equal(replay.appended, false);
  assert.deepEqual(replay.value, activated.value);

  const log = source.store.readJsonl('v2/generations.jsonl');
  const validated = source.authority.validateLog(
    log.value,
    current.change_id
  );
  assert.equal(validated.ok, true, JSON.stringify(validated.blockers));
  assert.equal(validated.active.id, activated.value.id);
});

test('successor generation blocks stale reviews and frozen history drift', () => {
  const source = fixture();
  const current = state();
  const prepared = source.authority.prepare(current);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.blockers));

  const changedBeforeApproval = structuredClone(current);
  changedBeforeApproval.collections.failures[0].status = 'closed';
  const stale = source.authority.append(
    source.store,
    prepared.review,
    changedBeforeApproval,
    true
  );
  assert.equal(stale.ok, false);
  assert.equal(
    stale.blockers[0].id,
    'verification-generation:review-stale'
  );

  const activated = source.authority.append(
    source.store,
    prepared.review,
    current,
    true
  );
  assert.equal(activated.ok, true, JSON.stringify(activated.blockers));

  const changedAfterActivation = structuredClone(current);
  changedAfterActivation.collections.runs[0].status = 'passed';
  const active = source.authority.validateActive(
    activated.value,
    changedAfterActivation
  );
  assert.equal(active.ok, false);
  assert.equal(
    active.blockers.some((entry) => (
      entry.id === 'verification-generation:baseline-drift'
      && entry.artifact === 'runs'
    )),
    true
  );
});
