'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createRepairLoopStateMachine
} = require('../../../plugins/specnav-verification/kernel/repair');
const {
  canonicalJson,
  sha256
} = require('../../../plugins/specnav-verification/kernel/evidence/identity');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures/positive'
);
const FIXED_TIME = '2026-08-01T07:30:00.000Z';
const TRUST_SECRET = Buffer.from(
  'task-020-test-trust-authority-not-production-secret',
  'utf8'
);
const PRODUCERS = Object.freeze({
  classification_result: 'specnav-failure-classifier',
  repair_link: 'specnav-development-repair-bridge',
  attempt_fact: 'specnav-execution-evidence',
  rerun_plan: 'specnav-case-rerun-planner'
});
const CLAIMS = Object.freeze({
  classification_result: ['failure-classification:verified'],
  repair_link: [
    'repair-review:spec-approved',
    'repair-review:quality-approved',
    'repair-evidence:verified'
  ],
  attempt_fact: [
    'attempt-binding:verified',
    'evidence-integrity:verified'
  ],
  rerun_plan: [
    'rerun-scope:approved-current',
    'rerun-scope:policy-complete'
  ]
});

function clone(value) {
  return structuredClone(value);
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, `${name}.json`),
    'utf8'
  ));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function envelopeSignature(value) {
  const unsigned = clone(value);
  delete unsigned.signature;
  return crypto
    .createHmac('sha256', TRUST_SECRET)
    .update(canonicalJson(unsigned))
    .digest('hex');
}

function seal(kind, payload, bindings) {
  const payloadClone = clone(payload);
  const payloadDigest = sha256(canonicalJson(payloadClone));
  const unsigned = {
    schema: 'specnav.verification.trusted-fact-envelope.v1',
    id: `trusted-fact-${sha256(canonicalJson({
      kind,
      payload_digest: payloadDigest,
      bindings
    }))}`,
    kind,
    producer: PRODUCERS[kind],
    payload: payloadClone,
    payload_digest: payloadDigest,
    issued_at: FIXED_TIME,
    bindings: clone(bindings),
    claims: [...CLAIMS[kind]],
    signature_algorithm: 'hmac-sha256'
  };
  return deepFreeze({
    ...unsigned,
    signature: envelopeSignature(unsigned)
  });
}

const TRUST_VERIFIER = Object.freeze({
  verify(envelope) {
    const actual = Buffer.from(envelope.signature, 'hex');
    const expected = Buffer.from(envelopeSignature(envelope), 'hex');
    if (
      actual.length !== expected.length
      || !crypto.timingSafeEqual(actual, expected)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      envelope_id: envelope.id,
      payload_digest: envelope.payload_digest,
      producer: envelope.producer
    };
  }
});

function initialAttempt(overrides = {}) {
  return {
    ...fixture('attempt'),
    status: 'failed',
    completed_at: '2026-07-31T00:00:01Z',
    exit_status: 1,
    ...overrides
  };
}

function classificationResult(options = {}) {
  const {
    classification = 'product_defect',
    breakLoop = false
  } = options;
  const packet = {
    ...fixture('failure-packet'),
    classification,
    owner: ['product_defect', 'test_defect'].includes(classification)
      ? 'development'
      : 'verification',
    status: ['product_defect', 'test_defect'].includes(classification)
      ? 'repair_required'
      : 'retry_allowed',
    next_action: ['product_defect', 'test_defect'].includes(classification)
      ? 'repair_required'
      : 'retry_allowed'
  };
  const result = {
    ok: true,
    status: 'classified',
    packet,
    signals: breakLoop
      ? [{
          kind: 'break_loop_required',
          no_progress_count: 3,
          threshold: 3,
          failure_packet_id: packet.id
        }]
      : [],
    blockers: []
  };
  return deepFreeze(result);
}

function fingerprint(attempt, overrides = {}) {
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

function completedRepair(baseAttempt = initialAttempt(), overrides = {}) {
  return {
    ...fixture('repair-link'),
    status: 'completed',
    completed_at: '2026-08-01T07:20:00Z',
    before_identity: fingerprint(baseAttempt),
    after_identity: fingerprint(baseAttempt, {
      code_sha: '3'.repeat(40)
    }),
    review_evidence_ids: ['repair-spec-review', 'repair-quality-review'],
    ...overrides
  };
}

function attemptFact(attempt, overrides = {}) {
  const verdict = attempt.status === 'passed'
    ? 'pass'
    : attempt.status === 'blocked'
      ? 'blocked'
      : 'fail';
  return {
    attempt_id: attempt.id,
    case_id: attempt.case_id,
    attempt_digest: sha256(canonicalJson(attempt)),
    verdict,
    evidence_ids: [`evidence-${attempt.id}`],
    integrity: 'intact',
    freshness: 'fresh',
    recorded_at: attempt.completed_at,
    ...overrides
  };
}

function retestAttempt(baseAttempt = initialAttempt(), overrides = {}) {
  return {
    ...baseAttempt,
    id: 'attempt-retest',
    run_id: 'run-retest',
    kind: 'retest',
    sequence: 2,
    parent_attempt_id: baseAttempt.id,
    code_sha: '3'.repeat(40),
    status: 'passed',
    started_at: '2026-08-01T07:21:00Z',
    completed_at: '2026-08-01T07:21:01Z',
    exit_status: 0,
    ...overrides
  };
}

function regressionAttempt(baseAttempt = retestAttempt(), overrides = {}) {
  const caseId = overrides.case_id || 'case-baseline';
  return {
    ...baseAttempt,
    id: 'attempt-regression-baseline',
    run_id: overrides.run_id || `run-regression-${caseId}`,
    case_id: caseId,
    kind: 'regression',
    sequence: 3,
    parent_attempt_id: baseAttempt.id,
    status: 'passed',
    started_at: '2026-08-01T07:22:00Z',
    completed_at: '2026-08-01T07:22:01Z',
    exit_status: 0,
    ...overrides
  };
}

function runHistory(attempts, packet) {
  const base = fixture('verification-run');
  const attemptsById = new Map(attempts.map((attempt) => [
    attempt.id,
    attempt
  ]));
  const groups = new Map();
  for (const attempt of attempts) {
    const values = groups.get(attempt.run_id) || [];
    values.push(attempt);
    groups.set(attempt.run_id, values);
  }
  return [...groups.entries()].map(([runId, runAttempts]) => {
    const first = runAttempts[0];
    const latest = runAttempts.at(-1);
    const parent = latest.parent_attempt_id
      ? attemptsById.get(latest.parent_attempt_id)
      : null;
    const linked = ['retest', 'regression'].includes(latest.kind);
    return {
      ...base,
      id: runId,
      change_id: first.change_id,
      case_snapshot_hash: first.case_snapshot_hash,
      case_ids: [...new Set(runAttempts.map((entry) => entry.case_id))],
      code_sha: first.code_sha,
      test_sha: first.test_sha,
      environment_hash: first.environment_hash,
      runtime_version: first.runtime_version,
      kernel_version: first.kernel_version,
      status: latest.status,
      created_at: first.started_at,
      started_at: first.started_at,
      completed_at: latest.completed_at,
      kind: linked ? latest.kind : 'initial',
      origin_run_id: linked ? packet.run_id : null,
      parent_run_id: linked ? parent?.run_id || null : null,
      parent_attempt_id: linked ? parent?.id || null : null,
      failure_id: linked ? packet.id : null
    };
  });
}

function rerunPlan(overrides = {}) {
  return {
    ok: true,
    full_rerun: false,
    required_cases: ['case-baseline', 'case-minimal'],
    baseline_cases: ['case-baseline'],
    repaired_cases: ['case-minimal'],
    impacted_cases: [],
    stale_cases: [],
    cases_to_rerun: [
      { case_id: 'case-baseline', reasons: ['policy-baseline'] },
      { case_id: 'case-minimal', reasons: ['repaired-case'] }
    ],
    reasons_by_case: {
      'case-baseline': ['policy-baseline'],
      'case-minimal': ['repaired-case']
    },
    changed_files: ['src/product.js'],
    unmapped_changes: [],
    domains_to_rerun: ['unit'],
    codegraph_refs: [],
    policy_refs: ['policy-required-baseline'],
    warnings: [],
    blockers: [],
    ...overrides
  };
}

function scopeProjection(plan) {
  const sorted = (values) => [...new Set(values)].sort();
  return {
    required_cases: sorted(plan.required_cases),
    baseline_cases: sorted(plan.baseline_cases),
    repaired_cases: sorted(plan.repaired_cases),
    impacted_cases: sorted(plan.impacted_cases),
    cases_to_rerun: [...plan.cases_to_rerun]
      .map((entry) => ({
        case_id: entry.case_id,
        reasons: sorted(entry.reasons)
      }))
      .sort((left, right) => left.case_id.localeCompare(right.case_id)),
    reasons_by_case: Object.fromEntries(
      Object.entries(plan.reasons_by_case)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([caseId, reasons]) => [caseId, sorted(reasons)])
    )
  };
}

const RERUN_SCOPE_AUTHORITY = Object.freeze({
  resolve(binding) {
    if (
      binding.failure_id !== 'failure-minimal'
      || binding.change_id !== 'change-v2'
      || binding.run_id !== 'run-minimal'
      || binding.case_id !== 'case-minimal'
    ) {
      return { ok: false };
    }
    const scope = scopeProjection(rerunPlan());
    return deepFreeze({
      ok: true,
      scope,
      scope_digest: sha256(canonicalJson(scope))
    });
  }
});

function request(options = {}) {
  const first = options.firstAttempt || initialAttempt();
  const attempts = options.attempts || [first];
  const classificationPayload = options.classificationResult
    || classificationResult();
  const packet = classificationPayload.packet;
  const baseBindings = {
    failure_id: packet.id,
    change_id: packet.change_id,
    run_id: packet.run_id,
    case_id: packet.case_id
  };
  const factPayloads = options.attemptFacts
    || attempts.map((attempt) => attemptFact(attempt));
  return {
    classification_result: options.classificationEnvelope
      || seal(
        'classification_result',
        classificationPayload,
        baseBindings
      ),
    attempts,
    attempt_facts: options.attemptFactEnvelopes
      || factPayloads.map((fact, index) => seal(
        'attempt_fact',
        fact,
        {
          ...baseBindings,
          run_id: attempts[index].run_id,
          case_id: attempts[index].case_id,
          attempt_id: attempts[index].id
        }
      )),
    runs: options.runs || runHistory(attempts, packet),
    ...(options.repairLink === undefined && options.repairEnvelope === undefined
      ? {}
      : {
          repair_link: options.repairEnvelope || seal(
            'repair_link',
            options.repairLink,
            baseBindings
          )
        }),
    ...(options.rerunPlan === undefined && options.rerunEnvelope === undefined
      ? {}
      : {
          rerun_plan: options.rerunEnvelope || seal(
            'rerun_plan',
            options.rerunPlan,
            baseBindings
          )
        }),
    ...(options.extra || {})
  };
}

function factory() {
  assert.equal(
    typeof createRepairLoopStateMachine,
    'function',
    'Task 020 RED: createRepairLoopStateMachine API is unavailable'
  );
  const machine = createRepairLoopStateMachine({
    schemaRegistry: readySchemaRegistry(),
    trustVerifier: TRUST_VERIFIER,
    rerunScopeAuthority: RERUN_SCOPE_AUTHORITY,
    clock: () => FIXED_TIME
  });
  assert.equal(typeof machine.evaluate, 'function');
  return machine;
}

function blockerIds(result) {
  return result.blockers.map((entry) => entry.id);
}

test('preserves first failure repair retest and regression as immutable history', () => {
  const first = initialAttempt();
  const retest = retestAttempt(first);
  const regression = regressionAttempt(retest);
  const input = request({
    attempts: [first, retest, regression],
    attemptFacts: [
      attemptFact(first),
      attemptFact(retest),
      attemptFact(regression)
    ],
    repairLink: completedRepair(first),
    rerunPlan: rerunPlan()
  });
  const before = clone(input);
  const result = factory().evaluate(input);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'closure_ready');
  assert.equal(result.label, 'pass_after_fix');
  assert.equal(result.transition_proposal.action, 'close_failure');
  assert.equal(result.transition_proposal.owner, 'core');
  assert.match(result.transition_proposal.scope_digest, /^[a-f0-9]{64}$/);
  assert.equal(
    readySchemaRegistry().validate(
      'transition-proposal',
      result.transition_proposal
    ).ok,
    true,
    JSON.stringify(result.transition_proposal)
  );
  assert.equal(Object.hasOwn(result, 'transition'), false);
  assert.deepEqual(
    result.history.map((entry) => [entry.kind, entry.label]),
    [
      ['initial', 'FAILED'],
      ['repair', 'REPAIR COMPLETED'],
      ['retest', 'PASS AFTER FIX'],
      ['regression', 'PASS']
    ]
  );
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.history), true);
  assert.equal(Object.isFrozen(result.transition_proposal), true);
});

test('labels an unchanged-fingerprint retry pass as flaky', () => {
  const first = initialAttempt();
  const retry = {
    ...first,
    id: 'attempt-retry',
    kind: 'retry',
    sequence: 2,
    parent_attempt_id: first.id,
    status: 'passed',
    started_at: '2026-07-31T00:00:02Z',
    completed_at: '2026-07-31T00:00:03Z',
    exit_status: 0
  };
  const result = factory().evaluate(request({
    classificationResult: classificationResult({
      classification: 'environment_defect'
    }),
    attempts: [first, retry],
    attemptFacts: [attemptFact(first), attemptFact(retry)]
  }));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'closure_ready');
  assert.equal(result.label, 'flaky');
  assert.equal(result.transition_proposal.action, 'close_failure');
  assert.equal(result.history.at(-1).label, 'FLAKY');
});

test('selects initial and latest attempts deterministically from shuffled same-second history', () => {
  const first = initialAttempt({
    id: 'attempt-20260802010000-z-initial',
    started_at: '2026-08-02T01:00:00Z',
    completed_at: '2026-08-02T01:00:00Z'
  });
  const retry = {
    ...first,
    id: 'attempt-20260802010000-a-retry',
    kind: 'retry',
    sequence: 2,
    parent_attempt_id: first.id,
    status: 'failed',
    exit_status: 1
  };
  const latestRetry = {
    ...retry,
    id: 'attempt-20260802010000-b-retry',
    sequence: 3,
    parent_attempt_id: retry.id,
    status: 'passed',
    exit_status: 0
  };
  const packet = clone(classificationResult({
    classification: 'environment_defect'
  }));
  packet.packet.attempt_id = first.id;
  packet.packet.run_id = first.run_id;
  packet.packet.case_id = first.case_id;
  packet.packet.change_id = first.change_id;
  const attempts = [latestRetry, first, retry];
  const result = factory().evaluate(request({
    firstAttempt: first,
    classificationResult: packet,
    attempts,
    runs: runHistory([first, retry, latestRetry], packet.packet),
    attemptFacts: attempts.map((attempt) => attemptFact(attempt))
  }));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'closure_ready');
  assert.equal(result.label, 'flaky');
  assert.deepEqual(
    result.history.map((entry) => entry.attempt_id),
    [first.id, retry.id, latestRetry.id]
  );
});

test('allows parallel regression branches with the same sequence and chooses each case deterministically', () => {
  const first = initialAttempt();
  const retest = retestAttempt(first);
  const baseline = regressionAttempt(retest, {
    id: 'attempt-regression-z',
    case_id: 'case-baseline',
    started_at: '2026-08-01T07:22:00Z',
    completed_at: '2026-08-01T07:22:01Z'
  });
  const attempts = [baseline, first, retest];
  const result = factory().evaluate(request({
    attempts,
    runs: runHistory([first, retest, baseline], classificationResult().packet),
    attemptFacts: attempts.map((attempt) => attemptFact(attempt)),
    repairLink: completedRepair(first),
    rerunPlan: rerunPlan()
  }));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'closure_ready');
  assert.equal(result.transition_proposal.action, 'close_failure');
});

test('rejects retry when any immutable retry fingerprint changes', () => {
  const first = initialAttempt();
  const retry = {
    ...first,
    id: 'attempt-retry-drifted',
    kind: 'retry',
    sequence: 2,
    parent_attempt_id: first.id,
    code_sha: '9'.repeat(40),
    status: 'passed',
    started_at: '2026-07-31T00:00:02Z',
    completed_at: '2026-07-31T00:00:03Z',
    exit_status: 0
  };
  const result = factory().evaluate(request({
    classificationResult: classificationResult({
      classification: 'environment_defect'
    }),
    attempts: [first, retry],
    attemptFacts: [attemptFact(first), attemptFact(retry)]
  }));

  assert.equal(result.ok, false);
  assert.equal(
    blockerIds(result).includes(
      'verification-contract:retry-fingerprint-mismatch'
    ),
    true,
    JSON.stringify(result.blockers)
  );
});

test('product and test defects cannot use retry to bypass reviewed repair', () => {
  const first = initialAttempt();
  const retry = {
    ...first,
    id: 'attempt-retry-forbidden',
    kind: 'retry',
    sequence: 2,
    parent_attempt_id: first.id,
    status: 'passed',
    started_at: '2026-07-31T00:00:02Z',
    completed_at: '2026-07-31T00:00:03Z',
    exit_status: 0
  };
  const result = factory().evaluate(request({
    attempts: [first, retry],
    attemptFacts: [attemptFact(first), attemptFact(retry)]
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(blockerIds(result), [
    'verification-repair-loop:retry-not-eligible'
  ]);
});

test('completed repair proposes retest and passed retest requires exact regression scope', () => {
  const first = initialAttempt();
  const repair = completedRepair(first);
  const repairReady = factory().evaluate(request({ repairLink: repair }));
  assert.equal(repairReady.ok, true, JSON.stringify(repairReady.blockers));
  assert.equal(repairReady.status, 'retest_required');
  assert.equal(repairReady.transition_proposal.action, 'request_retest');

  const retest = retestAttempt(first);
  const regressionRequired = factory().evaluate(request({
    attempts: [first, retest],
    attemptFacts: [attemptFact(first), attemptFact(retest)],
    repairLink: repair,
    rerunPlan: rerunPlan()
  }));
  assert.equal(
    regressionRequired.ok,
    true,
    JSON.stringify(regressionRequired.blockers)
  );
  assert.equal(regressionRequired.status, 'regression_required');
  assert.equal(
    regressionRequired.transition_proposal.action,
    'request_regression'
  );
  assert.deepEqual(
    regressionRequired.transition_proposal.case_ids,
    ['case-baseline']
  );
});

test('failed blocked stale or tampered required regression proposes reopen', () => {
  for (const mutation of [
    { status: 'failed', exit_status: 1, verdict: 'fail' },
    { status: 'blocked', exit_status: null, verdict: 'blocked' },
    { freshness: 'stale' },
    { integrity: 'invalid' }
  ]) {
    const first = initialAttempt();
    const retest = retestAttempt(first);
    const regression = regressionAttempt(retest, {
      ...(mutation.status ? { status: mutation.status } : {}),
      ...(Object.hasOwn(mutation, 'exit_status')
        ? { exit_status: mutation.exit_status }
        : {})
    });
    const regressionFact = attemptFact(regression, {
      ...(mutation.verdict ? { verdict: mutation.verdict } : {}),
      ...(mutation.freshness ? { freshness: mutation.freshness } : {}),
      ...(mutation.integrity ? { integrity: mutation.integrity } : {})
    });
    const result = factory().evaluate(request({
      attempts: [first, retest, regression],
      attemptFacts: [
        attemptFact(first),
        attemptFact(retest),
        regressionFact
      ],
      repairLink: completedRepair(first),
      rerunPlan: rerunPlan()
    }));

    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.status, 'reopen_required');
    assert.equal(result.transition_proposal.action, 'reopen_failure');
  }
});

test('closure fails closed when rerun plan omits repaired impacted or baseline cases', () => {
  const first = initialAttempt();
  const retest = retestAttempt(first);
  for (const plan of [
    rerunPlan({ required_cases: ['case-baseline'] }),
    rerunPlan({
      required_cases: ['case-minimal'],
      baseline_cases: ['case-baseline']
    }),
    rerunPlan({
      ok: false,
      blockers: [{ id: 'verification-rerun:approval-invalid' }]
    })
  ]) {
    const result = factory().evaluate(request({
      attempts: [first, retest],
      attemptFacts: [attemptFact(first), attemptFact(retest)],
      repairLink: completedRepair(first),
      rerunPlan: plan
    }));
    assert.equal(result.ok, false);
    assert.equal(
      blockerIds(result).some((id) => (
        id.startsWith('verification-repair-loop:rerun-plan-')
      )),
      true,
      JSON.stringify(result.blockers)
    );
  }
});

test('routes only a trusted classifier no-progress signal to Core break-loop governance', () => {
  const trusted = factory().evaluate(request({
    classificationResult: classificationResult({ breakLoop: true })
  }));
  assert.equal(trusted.ok, true, JSON.stringify(trusted.blockers));
  assert.equal(trusted.status, 'break_loop_required');
  assert.equal(trusted.transition_proposal.action, 'route_break_loop');
  assert.equal(trusted.transition_proposal.owner, 'core');
  assert.equal(Object.hasOwn(trusted, 'transition'), false);

  const forged = deepFreeze(clone(classificationResult({ breakLoop: true })));
  const rejected = factory().evaluate(request({
    classificationEnvelope: forged
  }));
  assert.equal(rejected.ok, false);
  assert.deepEqual(blockerIds(rejected), [
    'verification-repair-loop:trusted-envelope-invalid'
  ]);
});

test('rejects caller-authored lifecycle fields fallback and manual green', () => {
  for (const [field, value] of [
    ['transition', 'closed'],
    ['transition_proposal', { action: 'close_failure' }],
    ['status', 'closed'],
    ['signals', [{ kind: 'break_loop_required' }]],
    ['fallback_used', true],
    ['manual_green', true],
    ['verification_mode', 'light']
  ]) {
    const result = factory().evaluate(request({
      extra: { [field]: value }
    }));
    assert.equal(result.ok, false, field);
    assert.deepEqual(blockerIds(result), [
      'verification-repair-loop:request-field-unknown'
    ]);
  }
});

test('rejects duplicate overwritten out-of-order and cross-failure history', () => {
  const first = initialAttempt();
  const duplicate = { ...first };
  const duplicateResult = factory().evaluate(request({
    attempts: [first, duplicate],
    attemptFacts: [attemptFact(first), attemptFact(duplicate)]
  }));
  assert.equal(
    blockerIds(duplicateResult).includes(
      'verification-repair-loop:attempt-duplicate'
    ),
    true
  );

  const retest = retestAttempt(first, { sequence: 1 });
  const orderResult = factory().evaluate(request({
    attempts: [first, retest],
    attemptFacts: [attemptFact(first), attemptFact(retest)],
    repairLink: completedRepair(first),
    rerunPlan: rerunPlan()
  }));
  assert.equal(
    blockerIds(orderResult).includes(
      'verification-repair-loop:attempt-sequence-invalid'
    ),
    true
  );

  const foreignRepair = completedRepair(first, {
    failure_id: 'failure-other'
  });
  const bindingResult = factory().evaluate(request({
    repairLink: foreignRepair
  }));
  assert.equal(
    blockerIds(bindingResult).includes(
      'verification-repair-loop:repair-link-binding-mismatch'
    ),
    true
  );
});

test('rejects forged repair rerun and attempt-fact envelopes', () => {
  const first = initialAttempt();
  const retest = retestAttempt(first);
  const repair = completedRepair(first);
  const plan = rerunPlan();
  const good = request({
    attempts: [first, retest],
    attemptFacts: [attemptFact(first), attemptFact(retest)],
    repairLink: repair,
    rerunPlan: plan
  });

  for (const mutation of [
    () => {
      const envelope = clone(good.repair_link);
      envelope.payload.review_evidence_ids = ['forged-a', 'forged-b'];
      envelope.payload_digest = sha256(canonicalJson(envelope.payload));
      return { repairEnvelope: deepFreeze(envelope) };
    },
    () => {
      const envelope = clone(good.rerun_plan);
      envelope.payload.required_cases = ['case-minimal'];
      envelope.payload.baseline_cases = [];
      envelope.payload.cases_to_rerun = [{
        case_id: 'case-minimal',
        reasons: ['repaired-case']
      }];
      envelope.payload.reasons_by_case = {
        'case-minimal': ['repaired-case']
      };
      envelope.payload_digest = sha256(canonicalJson(envelope.payload));
      return { rerunEnvelope: deepFreeze(envelope) };
    },
    () => {
      const envelopes = clone(good.attempt_facts);
      envelopes[1].payload.evidence_ids = ['evidence-forged-pass'];
      envelopes[1].payload_digest = sha256(
        canonicalJson(envelopes[1].payload)
      );
      return { attemptFactEnvelopes: deepFreeze(envelopes) };
    }
  ]) {
    const override = mutation();
    const result = factory().evaluate(request({
      attempts: [first, retest],
      attemptFacts: [attemptFact(first), attemptFact(retest)],
      repairLink: repair,
      rerunPlan: plan,
      ...override
    }));
    assert.equal(result.ok, false);
    assert.equal(
      blockerIds(result).includes(
        'verification-repair-loop:trusted-envelope-unverified'
      ),
      true,
      JSON.stringify(result.blockers)
    );
  }
});

test('rejects foreign run or change attempts and unplanned regression cases', () => {
  const first = initialAttempt();
  const retest = retestAttempt(first);
  const packet = classificationResult().packet;
  const trustedRuns = runHistory([first, retest], packet);
  for (const [mutation, expectedBlocker] of [
    [
      { run_id: 'run-foreign' },
      'verification-repair-loop:attempt-run-missing'
    ],
    [
      { change_id: 'change-foreign' },
      'verification-repair-loop:attempt-context-mismatch'
    ]
  ]) {
    const foreignRetest = {
      ...retest,
      ...mutation
    };
    const result = factory().evaluate(request({
      attempts: [first, foreignRetest],
      attemptFacts: [
        attemptFact(first),
        attemptFact(foreignRetest)
      ],
      runs: trustedRuns,
      repairLink: completedRepair(first),
      rerunPlan: rerunPlan()
    }));
    assert.equal(result.ok, false);
    assert.equal(
      blockerIds(result).includes(
        expectedBlocker
      ),
      true,
      JSON.stringify(result.blockers)
    );
  }

  const extra = regressionAttempt(retest, {
    id: 'attempt-regression-unrelated',
    case_id: 'case-unrelated'
  });
  const extraResult = factory().evaluate(request({
    attempts: [first, retest, extra],
    attemptFacts: [
      attemptFact(first),
      attemptFact(retest),
      attemptFact(extra)
    ],
    repairLink: completedRepair(first),
    rerunPlan: rerunPlan()
  }));
  assert.equal(extraResult.ok, false);
  assert.deepEqual(blockerIds(extraResult), [
    'verification-repair-loop:regression-binding-mismatch'
  ]);
});

test('requires the exact Task 022 repaired impacted and baseline case set', () => {
  const first = initialAttempt();
  const retest = retestAttempt(first);
  const unrelated = regressionAttempt(retest, {
    id: 'attempt-regression-unrelated',
    case_id: 'case-unrelated'
  });
  const plan = rerunPlan({
    required_cases: ['case-baseline', 'case-minimal', 'case-unrelated'],
    impacted_cases: ['case-unrelated'],
    cases_to_rerun: [
      { case_id: 'case-baseline', reasons: ['policy-baseline'] },
      { case_id: 'case-minimal', reasons: ['repaired-case'] },
      { case_id: 'case-unrelated', reasons: ['caller-added'] }
    ],
    reasons_by_case: {
      'case-baseline': ['policy-baseline'],
      'case-minimal': ['repaired-case'],
      'case-unrelated': ['caller-added']
    }
  });
  const result = factory().evaluate(request({
    attempts: [first, retest, unrelated],
    attemptFacts: [
      attemptFact(first),
      attemptFact(retest),
      attemptFact(unrelated)
    ],
    repairLink: completedRepair(first),
    rerunPlan: plan
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(blockerIds(result), [
    'verification-repair-loop:rerun-scope-authority-mismatch'
  ]);
});
