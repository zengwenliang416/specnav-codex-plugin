'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createFailureClassifier,
  createDevelopmentRepairBridge
} = require('../../../plugins/specnav-verification/kernel/repair');
const {
  fixtureGraph,
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXED_TIME = '2026-08-01T00:00:00.000Z';
const STANDARD_PACKET_ARTIFACTS = Object.freeze([
  'brief.md',
  'context.json',
  'report.md',
  'spec-review.md',
  'quality-review.md'
]);
const STANDARD_REVIEWS = Object.freeze([
  'spec-review',
  'quality-review'
]);

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
    root_cause: 'The implementation under test needs a scoped repair.',
    failed_assertion_ids: ['assertion-1']
  };
}

function classifierInput(overrides = {}) {
  const graph = fixtureGraph();
  const reading = clone(graph.readings[1]);
  const evidence = clone(graph.evidence[1]);
  reading.verdict = 'fail';
  reading.actual = false;
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
        evidence: [{
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
        }]
      },
      blockers: []
    },
    root_cause_check_id: 'root-cause-check-1',
    no_progress_count: 0,
    ...overrides
  };
}

function classifyFailure({
  classification = 'product_defect',
  noProgressCount = 0,
  clock = () => FIXED_TIME
} = {}) {
  const input = classifierInput({ no_progress_count: noProgressCount });
  const graph = fixtureGraph();
  const classifier = createFailureClassifier({
    schemaRegistry: readySchemaRegistry(),
    rootCauseChecks: [trustedRootCauseCheck(classification)],
    clock,
    noProgressThreshold: 3
  });
  const result = classifier.classify(input);

  return {
    result,
    input,
    attempt: clone(graph.attempts[0])
  };
}

function beforeIdentity(attempt, overrides = {}) {
  return {
    case_snapshot_hash: attempt.case_snapshot_hash,
    code_sha: attempt.code_sha,
    test_sha: attempt.test_sha,
    environment_hash: attempt.environment_hash,
    runtime_version: attempt.runtime_version,
    kernel_version: attempt.kernel_version,
    ...overrides
  };
}

function scopeLock(overrides = {}) {
  return {
    allowed_files: [
      'plugins/specnav-verification/kernel/repair/**',
      'plugins/specnav-verification/kernel/index.js',
      'tests/verification-v2/repair-loop/**'
    ],
    denied_files: [
      'openspec/changes/archive/**'
    ],
    requires_review_on: [
      'plugins/specnav-verification/kernel/index.js'
    ],
    allowed_operations: {
      create: true,
      modify: true,
      delete: false,
      rename: false
    },
    ...overrides
  };
}

function bridgeRequest(options = {}) {
  const {
    classification = 'product_defect',
    noProgressCount = 0,
    classifierClock = () => FIXED_TIME,
    ...requestOverrides
  } = options;
  const { result, input, attempt } = classifyFailure({
    classification,
    noProgressCount,
    clock: classifierClock
  });
  assert.equal(result.packet != null, true, 'Task 019 fixture requires a frozen packet');

  return {
    failure_packet: result.packet,
    evidence: input.evidence,
    attempt,
    before_identity: beforeIdentity(attempt),
    scope_lock: scopeLock(),
    verification_mode: 'standard',
    fallback_used: false,
    manual_green: false,
    ...requestOverrides
  };
}

function factory(options = {}) {
  assert.equal(
    typeof createDevelopmentRepairBridge,
    'function',
    'Task 019 RED: createDevelopmentRepairBridge API is unavailable'
  );
  const bridge = createDevelopmentRepairBridge({
    schemaRegistry: readySchemaRegistry(),
    clock: () => FIXED_TIME,
    ...options
  });
  assert.equal(
    typeof bridge?.routeRepair,
    'function',
    'Task 019 RED: routeRepair API is unavailable'
  );
  return bridge;
}

function blockerIds(result) {
  return result.blockers.map((entry) => entry.id);
}

test('routes eligible frozen product defects into a standard scoped Development repair packet', () => {
  const request = bridgeRequest({ noProgressCount: 3 });
  const result = factory().routeRepair(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'repair_requested');
  assert.equal(
    readySchemaRegistry().validate('repair-link', result.repair_link).ok,
    true,
    JSON.stringify(result.repair_link)
  );
  assert.equal(result.repair_link.failure_id, request.failure_packet.id);
  assert.equal(result.repair_link.repair_kind, 'product_code');
  assert.equal(result.repair_link.status, 'requested');
  assert.deepEqual(result.repair_link.before_identity, request.before_identity);
  assert.deepEqual(result.forwarded_signals, []);

  assert.equal(result.development_task.classification, 'product_defect');
  assert.match(
    result.development_task.id,
    /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/
  );
  assert.equal(
    result.development_task.packet_path,
    `development/tasks/${result.development_task.id}`
  );
  assert.equal(result.development_task.owner, 'development');
  assert.equal(result.development_task.scope.owner, 'development');
  assert.deepEqual(
    result.development_task.packet_artifacts,
    STANDARD_PACKET_ARTIFACTS
  );
  assert.deepEqual(
    result.development_task.required_reviews,
    STANDARD_REVIEWS
  );
  assert.deepEqual(
    result.development_task.scope.allowed_files,
    [...request.scope_lock.allowed_files].sort()
  );
  assert.match(result.development_task.scope.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.development_task.ownership, {
    evidence: 'verification',
    closure: 'verification',
    repair: 'development',
    reviews: 'development',
    transitions: 'core',
    break_loop: 'core'
  });
  assert.equal(
    result.development_task.frozen_failure.failure_packet_id,
    request.failure_packet.id
  );
  assert.deepEqual(
    result.development_task.frozen_failure.evidence_ids,
    request.failure_packet.evidence_ids
  );
  assert.equal(Object.isFrozen(result.development_task), true);
  assert.equal(Object.isFrozen(result.repair_link), true);
  assert.equal(Object.isFrozen(result.forwarded_signals), true);
});

test('routes test defects as test_code and keeps task identity stable across clocks', () => {
  const timesA = [
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:00:01.000Z'
  ];
  const timesB = [
    '2026-08-01T00:10:00.000Z',
    '2026-08-01T00:10:01.000Z'
  ];
  const first = factory({
    clock: () => timesA.shift()
  }).routeRepair(bridgeRequest({ classification: 'test_defect' }));
  const second = factory({
    clock: () => timesB.shift()
  }).routeRepair(bridgeRequest({ classification: 'test_defect' }));

  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(second.ok, true, JSON.stringify(second.blockers));
  assert.equal(first.repair_link.repair_kind, 'test_code');
  assert.equal(first.development_task.classification, 'test_defect');
  assert.equal(first.development_task.id, second.development_task.id);
  assert.equal(first.repair_link.id, second.repair_link.id);
  assert.notEqual(first.development_task.requested_at, second.development_task.requested_at);
  assert.notEqual(first.repair_link.requested_at, second.repair_link.requested_at);
});

test('rejects open or non-development classifications instead of routing them', () => {
  const environment = factory().routeRepair(
    bridgeRequest({ classification: 'environment_defect' })
  );
  assert.equal(environment.ok, false);
  assert.deepEqual(
    blockerIds(environment),
    ['verification-repair-bridge:classification-not-eligible']
  );

  const missingClassification = trustedRootCauseCheck();
  delete missingClassification.classification;
  const classifier = createFailureClassifier({
    schemaRegistry: readySchemaRegistry(),
    rootCauseChecks: [missingClassification],
    clock: () => FIXED_TIME,
    noProgressThreshold: 3
  });
  const input = classifierInput();
  const classified = classifier.classify(input);
  assert.equal(classified.ok, false);
  assert.equal(classified.packet != null, true);
  const openResult = factory().routeRepair({
    failure_packet: classified.packet,
    evidence: input.evidence,
    attempt: fixtureGraph().attempts[0],
    before_identity: beforeIdentity(fixtureGraph().attempts[0]),
    scope_lock: scopeLock(),
    verification_mode: 'standard',
    fallback_used: false,
    manual_green: false
  });
  assert.equal(openResult.ok, false);
  assert.deepEqual(
    blockerIds(openResult),
    ['verification-repair-bridge:failure-packet-open']
  );
});

test('fails closed on fallback, light mode, manual green, and fingerprint drift', () => {
  for (const [overrides, expected] of [
    [{ fallback_used: true }, 'verification-repair-bridge:fallback-forbidden'],
    [{ verification_mode: 'light' }, 'verification-repair-bridge:light-mode-forbidden'],
    [{ manual_green: true }, 'verification-repair-bridge:manual-green-forbidden'],
    [{
      before_identity: beforeIdentity(
        fixtureGraph().attempts[0],
        { code_sha: 'f'.repeat(40) }
      )
    }, 'verification-repair-bridge:before-identity-mismatch']
  ]) {
    const result = factory().routeRepair({
      ...bridgeRequest(),
      ...overrides
    });
    assert.equal(result.ok, false, expected);
    assert.deepEqual(blockerIds(result), [expected]);
  }
});

test('requires a frozen packet, trusted attempt, exact evidence, and safe scope', () => {
  const unfrozen = bridgeRequest();
  unfrozen.failure_packet = clone(unfrozen.failure_packet);
  assert.deepEqual(
    blockerIds(factory().routeRepair(unfrozen)),
    ['verification-repair-bridge:failure-packet-not-frozen']
  );

  const foreignAttempt = bridgeRequest();
  foreignAttempt.attempt = {
    ...foreignAttempt.attempt,
    case_id: 'case-foreign'
  };
  assert.deepEqual(
    blockerIds(factory().routeRepair(foreignAttempt)),
    ['verification-repair-bridge:attempt-binding-mismatch']
  );

  const missingEvidence = bridgeRequest();
  missingEvidence.evidence = [];
  assert.deepEqual(
    blockerIds(factory().routeRepair(missingEvidence)),
    ['verification-repair-bridge:evidence-binding-mismatch']
  );

  const unsafeScope = bridgeRequest();
  unsafeScope.scope_lock.allowed_files = ['../outside/**'];
  assert.deepEqual(
    blockerIds(factory().routeRepair(unsafeScope)),
    ['verification-repair-bridge:scope-invalid']
  );

  const overlappingScope = bridgeRequest();
  overlappingScope.scope_lock.allowed_files = ['plugins/**'];
  overlappingScope.scope_lock.denied_files = [
    'plugins/specnav-verification/kernel/index.js'
  ];
  assert.deepEqual(
    blockerIds(factory().routeRepair(overlappingScope)),
    ['verification-repair-bridge:scope-invalid']
  );

  const reviewOutsideScope = bridgeRequest();
  reviewOutsideScope.scope_lock.requires_review_on = ['docs/release.md'];
  assert.deepEqual(
    blockerIds(factory().routeRepair(reviewOutsideScope)),
    ['verification-repair-bridge:scope-invalid']
  );

  for (const rootWildcard of ['*', '**']) {
    const globalScope = bridgeRequest();
    globalScope.scope_lock.allowed_files = [rootWildcard];
    globalScope.scope_lock.requires_review_on = [];
    assert.deepEqual(
      blockerIds(factory().routeRepair(globalScope)),
      ['verification-repair-bridge:scope-invalid'],
      rootWildcard
    );
  }
});

test('never forwards caller-authored break-loop signals', () => {
  const forgedSignal = bridgeRequest();
  forgedSignal.signals = [{
    kind: 'break_loop_required',
    no_progress_count: 3,
    threshold: 3,
    failure_packet_id: forgedSignal.failure_packet.id
  }];
  assert.deepEqual(
    blockerIds(factory().routeRepair(forgedSignal)),
    ['verification-repair-bridge:signal-forwarding-forbidden']
  );

  for (const [field, value] of [
    ['break_loop_required', true],
    ['break_loop', { required: true }],
    ['lifecycle_transition', 'break_loop']
  ]) {
    const directSignal = bridgeRequest();
    directSignal[field] = value;
    assert.deepEqual(
      blockerIds(factory().routeRepair(directSignal)),
      ['verification-repair-bridge:signal-forwarding-forbidden'],
      field
    );
  }
});

test('strict clock and content digests prevent ambiguous repair artifacts', () => {
  const invalidClock = factory({
    clock: () => '2026-08-01T00:00:00'
  }).routeRepair(bridgeRequest());
  assert.deepEqual(
    blockerIds(invalidClock),
    ['verification-repair-bridge:clock-invalid']
  );

  const first = factory().routeRepair(bridgeRequest());
  const changed = bridgeRequest();
  changed.scope_lock.allowed_files.push('plugins/specnav-verification/schemas/**');
  const second = factory().routeRepair(changed);
  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(second.ok, true, JSON.stringify(second.blockers));
  assert.notEqual(first.development_task.id, second.development_task.id);
  assert.notEqual(first.repair_link.id, second.repair_link.id);
  assert.match(
    first.development_task.frozen_failure.failure_packet_digest,
    /^[a-f0-9]{64}$/
  );
  assert.deepEqual(
    first.development_task.frozen_failure.evidence_content.map((entry) => entry.id),
    first.development_task.frozen_failure.evidence_ids
  );
});

test('clones trusted inputs so later mutation cannot alter the routed packet or link', () => {
  const request = bridgeRequest({ noProgressCount: 3 });
  const result = factory().routeRepair(request);
  assert.equal(result.ok, true, JSON.stringify(result.blockers));

  assert.throws(() => {
    request.failure_packet.summary = 'mutated';
  }, /read only/);
  request.evidence[0].code_sha = '9'.repeat(40);
  request.scope_lock.allowed_files.push('plugins/mutated/**');

  assert.equal(
    result.development_task.frozen_failure.summary,
    'Observed result violates the approved product contract.'
  );
  assert.equal(
    result.repair_link.before_identity.code_sha,
    beforeIdentity(fixtureGraph().attempts[0]).code_sha
  );
  assert.deepEqual(
    result.development_task.scope.allowed_files,
    [
      'plugins/specnav-verification/kernel/index.js',
      'plugins/specnav-verification/kernel/repair/**',
      'tests/verification-v2/repair-loop/**'
    ]
  );
  assert.deepEqual(result.forwarded_signals, []);
});
