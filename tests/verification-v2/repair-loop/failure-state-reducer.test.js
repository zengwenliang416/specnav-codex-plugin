'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createFailureStateReducer,
  createTrustedFactAuthority
} = require('../../../plugins/specnav-verification/kernel/repair');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXED_TIME = '2026-08-06T10:00:00.000Z';
const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../contracts/fixtures/positive'
);

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, name),
    'utf8'
  ));
}

function rootFailure(overrides = {}) {
  return {
    ...fixture('failure-packet.json'),
    classification: null,
    status: 'open',
    next_action: 'blocked_for_decision',
    owner: 'verification',
    ...overrides
  };
}

function initialRun(overrides = {}) {
  return {
    ...fixture('verification-run.json'),
    ...overrides
  };
}

function trust(registry) {
  return createTrustedFactAuthority({
    schemaRegistry: registry,
    key: Buffer.alloc(32, 9),
    clock: () => FIXED_TIME
  });
}

function classificationEnvelope(authority, failure) {
  return authority.seal('classification_result', {
    ok: true,
    status: 'classified',
    packet: {
      ...failure,
      classification: 'test_defect',
      status: 'repair_required',
      next_action: 'repair_required',
      owner: 'development'
    },
    signals: [],
    blockers: []
  }, {
    failure_id: failure.id,
    change_id: failure.change_id,
    run_id: failure.run_id,
    case_id: failure.case_id
  });
}

function reduce(overrides = {}) {
  const registry = readySchemaRegistry();
  const authority = trust(registry);
  const failure = overrides.failure || rootFailure();
  return createFailureStateReducer({
    schemaRegistry: registry,
    trustVerifier: authority
  }).reduce({
    expected_change_id: failure.change_id,
    failures: [failure],
    raw_failures: [failure],
    runs: [initialRun()],
    classification_envelopes: [classificationEnvelope(authority, failure)],
    transition_proposal_envelopes: [],
    transition_receipt_envelopes: [],
    ...overrides.request
  });
}

test('missing classification is an explicit blocker and remains open', () => {
  const failure = rootFailure();
  const result = reduce({
    failure,
    request: {
      classification_envelopes: []
    }
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.open_failure_ids, [failure.id]);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id
        === 'verification-failure-state:classification-missing-or-invalid'
    )),
    true
  );
});

test('valid follow-up runs are checked even when they produce no failure packet', () => {
  const failure = rootFailure();
  const followup = initialRun({
    id: 'run-retest-pass',
    kind: 'retest',
    status: 'passed',
    origin_run_id: failure.run_id,
    parent_run_id: failure.run_id,
    parent_attempt_id: failure.attempt_id,
    failure_id: failure.id
  });
  const result = reduce({
    failure,
    request: {
      runs: [initialRun(), followup]
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.open_failure_ids, [failure.id]);
});

test('foreign failure and broken parent lineage block follow-up runs', () => {
  const failure = rootFailure();
  const foreign = initialRun({
    id: 'run-retest-foreign',
    kind: 'retest',
    origin_run_id: failure.run_id,
    parent_run_id: failure.run_id,
    parent_attempt_id: failure.attempt_id,
    failure_id: 'failure-foreign'
  });
  const brokenParent = initialRun({
    id: 'run-regression-broken-parent',
    kind: 'regression',
    origin_run_id: failure.run_id,
    parent_run_id: 'run-missing',
    parent_attempt_id: 'attempt-missing',
    failure_id: failure.id
  });
  const result = reduce({
    failure,
    request: {
      runs: [initialRun(), foreign, brokenParent]
    }
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers
      .filter((entry) => (
        entry.id === 'verification-failure-state:followup-run-invalid'
      ))
      .map((entry) => entry.artifact)
      .sort(),
    ['run-regression-broken-parent', 'run-retest-foreign']
  );
});

test('raw failures from another change cannot enter the reducer', () => {
  const failure = rootFailure();
  const result = reduce({
    failure,
    request: {
      raw_failures: [{
        ...failure,
        id: 'failure-foreign',
        change_id: 'change-foreign'
      }]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-failure-state:raw-failure-invalid'
    )),
    true
  );
});
