'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createFailureClassifier
} = require('../../../plugins/specnav-verification/kernel/repair');
const {
  fixtureGraph,
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXED_TIME = '2026-08-01T00:00:00.000Z';
const CLASSIFICATION_POLICY = Object.freeze({
  product_defect: {
    owner: 'development',
    next_action: 'repair_required'
  },
  test_defect: {
    owner: 'development',
    next_action: 'repair_required'
  },
  environment_defect: {
    owner: 'verification',
    next_action: 'retry_allowed'
  },
  flaky: {
    owner: 'verification',
    next_action: 'retry_allowed'
  },
  expected_blocker: {
    owner: 'verification',
    next_action: 'blocked_for_decision'
  },
  requirement_ambiguity: {
    owner: 'core',
    next_action: 'blocked_for_decision'
  }
});

function clone(value) {
  return structuredClone(value);
}

function trustedRootCauseCheck(classification = 'product_defect') {
  return {
    id: 'root-cause-check-1',
    trusted: true,
    change_id: 'change-v2',
    run_id: 'run-minimal',
    case_id: 'case-minimal',
    attempt_id: 'attempt-minimal',
    classification,
    summary: 'Observed result violates the approved product contract.',
    root_cause: 'The product implementation returns the wrong value.',
    failed_assertion_ids: ['assertion-1']
  };
}

function fixture(overrides = {}) {
  const graph = fixtureGraph();
  const reading = clone(graph.readings[1]);
  const evidence = clone(graph.evidence[1]);
  reading.verdict = 'fail';
  reading.actual = false;
  assert.equal(
    readySchemaRegistry().validate('reading', reading).ok,
    true
  );
  assert.equal(
    readySchemaRegistry().validate('evidence', evidence).ok,
    true
  );
  const integrityFact = {
    evidence_id: evidence.id,
    integrity: 'intact',
    freshness: 'fresh',
    binding_match: true,
    exists: true,
    hash_match: true,
    size_match: true,
    producer_recognized: true,
    store_record_match: true,
    path_safe: true
  };
  return {
    readings: [reading],
    evidence: [evidence],
    integrity: {
      ok: true,
      facts: {
        summary: {
          evidence_count: 1,
          integrity: 'intact',
          freshness: 'fresh'
        },
        evidence: [integrityFact]
      },
      blockers: []
    },
    root_cause_check_id: 'root-cause-check-1',
    no_progress_count: 0,
    ...overrides
  };
}

function createClassifier(options = {}) {
  return createFailureClassifier({
    schemaRegistry: readySchemaRegistry(),
    rootCauseChecks: [trustedRootCauseCheck()],
    clock: () => FIXED_TIME,
    noProgressThreshold: 3,
    ...options
  });
}

test('classifies all six failure categories using explicit policy', () => {
  for (const [classification, policy] of Object.entries(
    CLASSIFICATION_POLICY
  )) {
    const input = fixture();
    const result = createClassifier({
      rootCauseChecks: [trustedRootCauseCheck(classification)]
    }).classify(input);

    assert.equal(result.ok, true, classification);
    assert.equal(result.packet.classification, classification);
    assert.equal(result.packet.owner, policy.owner);
    assert.equal(result.packet.next_action, policy.next_action);
    assert.equal(result.packet.status, policy.next_action);
    assert.equal(Object.isFrozen(result.packet), true);
  }
});

test('accepts only schema-valid failed or blocked readings', () => {
  const classifier = createClassifier();
  const failed = classifier.classify(fixture());
  assert.equal(failed.ok, true);

  const blockedInput = fixture();
  blockedInput.readings[0].verdict = 'blocked';
  assert.equal(classifier.classify(blockedInput).ok, true);

  const passedInput = fixture();
  passedInput.readings[0].verdict = 'pass';
  assert.deepEqual(
    classifier.classify(passedInput).blockers.map((entry) => entry.id),
    ['verification-failure:reading-invalid']
  );

  const invalidInput = fixture();
  delete invalidInput.readings[0].schema;
  assert.deepEqual(
    classifier.classify(invalidInput).blockers.map((entry) => entry.id),
    ['verification-failure:reading-invalid']
  );
});

test('requires every reading to share change run case and attempt identity', () => {
  const input = fixture();
  const second = clone(input.readings[0]);
  second.id = 'reading-unit-2';
  second.attempt_id = 'attempt-2';
  input.readings.push(second);

  const result = createClassifier().classify(input);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((entry) => entry.id),
    ['verification-failure:reading-binding-mismatch']
  );

  const checkMismatch = trustedRootCauseCheck();
  checkMismatch.run_id = 'run-other';
  assert.deepEqual(
    createClassifier({
      rootCauseChecks: [checkMismatch]
    }).classify(fixture()).blockers.map((entry) => entry.id),
    ['verification-failure:root-cause-check-binding-mismatch']
  );
});

test('binds evidence ids to matching intact and fresh integrity facts', () => {
  const classifier = createClassifier();
  const missingEvidence = fixture({ evidence: [] });
  assert.deepEqual(
    classifier.classify(missingEvidence).blockers.map((entry) => entry.id),
    ['verification-failure:evidence-missing']
  );

  const stale = fixture();
  stale.integrity.facts.evidence[0].freshness = 'stale';
  assert.deepEqual(
    classifier.classify(stale).blockers.map((entry) => entry.id),
    ['verification-failure:evidence-integrity-blocked']
  );

  const rebound = fixture();
  rebound.evidence[0].attempt_id = 'attempt-other';
  assert.deepEqual(
    classifier.classify(rebound).blockers.map((entry) => entry.id),
    ['verification-failure:evidence-binding-mismatch']
  );
});

test('produces a stable frozen packet id bound to reading and evidence content', () => {
  const classifier = createClassifier();
  const first = classifier.classify(fixture());
  const second = classifier.classify(fixture());

  assert.equal(first.ok, true);
  assert.equal(first.packet.id, second.packet.id);
  assert.equal(Object.isFrozen(first.packet), true);
  assert.equal(Object.isFrozen(first.packet.reading_ids), true);
  assert.equal(Object.isFrozen(first.packet.evidence_ids), true);

  const drifted = fixture();
  drifted.evidence[0].sha256 = 'd'.repeat(64);
  const third = classifier.classify(drifted);
  assert.equal(third.ok, true);
  assert.notEqual(first.packet.id, third.packet.id);
});

test('packet id covers frozen timestamps and clock requires RFC3339 timezone', () => {
  const times = [
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:00:01.000Z'
  ];
  const classifier = createClassifier({
    clock: () => times.shift()
  });
  const first = classifier.classify(fixture());
  const second = classifier.classify(fixture());

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.packet.id, second.packet.id);
  assert.notEqual(first.packet.frozen_at, second.packet.frozen_at);

  const invalidClock = createClassifier({
    clock: () => '2026-08-01T00:00:00'
  }).classify(fixture());
  assert.deepEqual(
    invalidClock.blockers.map((entry) => entry.id),
    ['verification-failure:clock-invalid']
  );
});

test('missing classification freezes a schema-valid open packet and blocks', () => {
  const missingClassification = trustedRootCauseCheck();
  delete missingClassification.classification;
  const result = createClassifier({
    rootCauseChecks: [missingClassification]
  }).classify(fixture());

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(
    result.blockers.map((entry) => entry.id),
    ['verification-failure:classification-missing']
  );
  assert.equal(result.packet.classification, null);
  assert.equal(result.packet.status, 'open');
  assert.equal(result.packet.next_action, 'blocked_for_decision');
  assert.equal(result.packet.owner, 'verification');
  assert.equal(Object.isFrozen(result.packet), true);
  assert.equal(
    readySchemaRegistry().validate('failure-packet', result.packet).ok,
    true
  );
});

test('blocks when trusted root-cause check is unavailable or untrusted', () => {
  const untrusted = trustedRootCauseCheck();
  untrusted.trusted = false;

  assert.deepEqual(
    createClassifier({
      rootCauseChecks: [untrusted]
    }).classify(fixture()).blockers.map((entry) => entry.id),
    ['verification-failure:root-cause-check-untrusted']
  );

  const proseOnly = fixture();
  proseOnly.root_cause_check_id = 'missing-root-cause-check';
  proseOnly.agent_summary = 'This looks like a flaky product failure.';
  assert.deepEqual(
    createClassifier().classify(proseOnly).blockers.map((entry) => entry.id),
    ['verification-failure:root-cause-check-missing']
  );
});

test('failed assertion ids exactly match non-empty reading assertion ids', () => {
  const injected = trustedRootCauseCheck();
  injected.failed_assertion_ids = ['assertion-1', 'assertion-injected'];
  assert.deepEqual(
    createClassifier({
      rootCauseChecks: [injected]
    }).classify(fixture()).blockers.map((entry) => entry.id),
    ['verification-failure:failed-assertion-set-mismatch']
  );

  const missing = trustedRootCauseCheck();
  missing.failed_assertion_ids = ['assertion-other'];
  assert.deepEqual(
    createClassifier({
      rootCauseChecks: [missing]
    }).classify(fixture()).blockers.map((entry) => entry.id),
    ['verification-failure:failed-assertion-set-mismatch']
  );

  const stepOnly = fixture();
  delete stepOnly.readings[0].assertion_id;
  stepOnly.readings[0].step_id = 'step-1';
  delete stepOnly.evidence[0].assertion_id;
  stepOnly.evidence[0].step_id = 'step-1';
  assert.equal(
    readySchemaRegistry().validate('reading', stepOnly.readings[0]).ok,
    true
  );
  assert.equal(
    readySchemaRegistry().validate('evidence', stepOnly.evidence[0]).ok,
    true
  );
  assert.deepEqual(
    createClassifier().classify(stepOnly).blockers.map((entry) => entry.id),
    ['verification-failure:reading-assertion-missing']
  );
});

test('reading evidence, supplied evidence, and integrity ids are exact sets', () => {
  const extraEvidence = fixture();
  const extraRecord = clone(extraEvidence.evidence[0]);
  extraRecord.id = 'evidence-extra';
  extraEvidence.evidence.push(extraRecord);
  assert.deepEqual(
    createClassifier().classify(extraEvidence).blockers.map(
      (entry) => entry.id
    ),
    ['verification-failure:evidence-set-mismatch']
  );

  const duplicateEvidence = fixture();
  duplicateEvidence.evidence.push(clone(duplicateEvidence.evidence[0]));
  assert.deepEqual(
    createClassifier().classify(duplicateEvidence).blockers.map(
      (entry) => entry.id
    ),
    ['verification-failure:evidence-set-mismatch']
  );

  const extraIntegrity = fixture();
  extraIntegrity.integrity.facts.evidence.push({
    ...clone(extraIntegrity.integrity.facts.evidence[0]),
    evidence_id: 'evidence-extra'
  });
  assert.deepEqual(
    createClassifier().classify(extraIntegrity).blockers.map(
      (entry) => entry.id
    ),
    ['verification-failure:integrity-evidence-set-mismatch']
  );

  const duplicateIntegrity = fixture();
  duplicateIntegrity.integrity.facts.evidence.push(clone(
    duplicateIntegrity.integrity.facts.evidence[0]
  ));
  assert.deepEqual(
    createClassifier().classify(duplicateIntegrity).blockers.map(
      (entry) => entry.id
    ),
    ['verification-failure:integrity-evidence-set-mismatch']
  );

  const wrongCount = fixture();
  wrongCount.integrity.facts.summary.evidence_count = 2;
  assert.deepEqual(
    createClassifier().classify(wrongCount).blockers.map(
      (entry) => entry.id
    ),
    ['verification-failure:integrity-summary-count-mismatch']
  );
});

test('clones trusted inputs so later external mutation cannot alter results', () => {
  const trustedChecks = [trustedRootCauseCheck()];
  const classifier = createClassifier({ rootCauseChecks: trustedChecks });
  trustedChecks[0].classification = 'flaky';
  trustedChecks[0].summary = 'mutated before classify';
  const input = fixture();
  const result = classifier.classify(input);

  input.readings[0].id = 'mutated-reading';
  input.evidence[0].id = 'mutated-evidence';
  input.root_cause_check_id = 'mutated-check';

  assert.equal(result.packet.reading_ids[0], 'reading-assertion');
  assert.equal(result.packet.evidence_ids[0], 'evidence-assertion');
  assert.equal(result.packet.classification, 'product_defect');
  assert.equal(
    result.packet.summary,
    'Observed result violates the approved product contract.'
  );
});

test('emits only break_loop_required when no-progress threshold is reached', () => {
  const input = fixture({ no_progress_count: 3 });
  const result = createClassifier().classify(input);

  assert.equal(result.ok, true);
  assert.equal(result.packet.next_action, 'repair_required');
  assert.deepEqual(result.signals, [{
    kind: 'break_loop_required',
    no_progress_count: 3,
    threshold: 3,
    failure_packet_id: result.packet.id
  }]);
  assert.equal(Object.hasOwn(result, 'transition'), false);
  assert.equal(Object.hasOwn(result, 'decision_artifact'), false);
});
