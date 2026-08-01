'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SIX_DOMAINS,
  createSixDomainAggregator
} = require('../../../plugins/specnav-verification/kernel/evaluation');
const {
  createDecisionEngine
} = require('../../../plugins/specnav-verification/kernel/gates');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const CHANGE_ID = 'change-v2';
const CASE_ID = 'case-minimal';

function reading(domain, overrides = {}) {
  const suffix = `${domain}-${overrides.attempt_id || 'attempt-1'}`;
  return {
    schema: 'specnav.verification.reading.v1',
    id: `reading-${suffix}`,
    change_id: CHANGE_ID,
    run_id: 'run-minimal',
    case_id: CASE_ID,
    attempt_id: 'attempt-1',
    step_id: 'step-1',
    assertion_id: 'assertion-1',
    domain,
    expected: true,
    actual: true,
    oracle: {
      type: 'structured_comparison',
      owner: 'command-runner',
      deterministic: true
    },
    evidence_ids: [`evidence-${suffix}`],
    verdict: 'pass',
    recorded_at: '2026-08-01T02:20:00Z',
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(40),
    ...overrides
  };
}

function evidenceForReading(source, evidenceId) {
  return {
    schema: 'specnav.verification.evidence.v1',
    id: evidenceId,
    kind: 'structured_comparison',
    path: `objects/${evidenceId}.json`,
    sha256: '3'.repeat(64),
    size: 42,
    producer: 'command-runner',
    captured_at: '2026-08-01T02:19:00Z',
    change_id: source.change_id,
    run_id: source.run_id,
    case_id: source.case_id,
    attempt_id: source.attempt_id,
    step_id: source.step_id,
    assertion_id: source.assertion_id,
    code_sha: source.code_sha,
    test_sha: source.test_sha,
    environment_hash: '4'.repeat(64),
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    domain: source.domain
  };
}

function evidenceAndIntegrity(readings) {
  const evidence = readings.flatMap((source) => (
    source.evidence_ids.map((id) => evidenceForReading(source, id))
  ));
  return {
    evidence,
    integrity: {
      ok: true,
      facts: {
        summary: {
          evidence_count: evidence.length,
          integrity: 'intact',
          freshness: 'fresh'
        },
        evidence: evidence.map((entry) => ({
          evidence_id: entry.id,
          integrity: 'intact',
          freshness: 'fresh',
          exists: true,
          hash_match: true,
          size_match: true,
          producer_recognized: true,
          store_record_match: true,
          binding_match: true,
          path_safe: true
        }))
      },
      blockers: []
    }
  };
}

function aggregateRequest(overrides = {}) {
  const request = {
    change_id: CHANGE_ID,
    case_ids: [CASE_ID],
    readings: SIX_DOMAINS.map((domain) => reading(domain)),
    policy_facts: {
      not_applicable_decisions: [],
      terminal_states: []
    },
    ...overrides
  };
  const evidenceState = evidenceAndIntegrity(request.readings);
  if (!Object.hasOwn(overrides, 'evidence')) {
    request.evidence = evidenceState.evidence;
  }
  if (!Object.hasOwn(overrides, 'integrity')) {
    request.integrity = evidenceState.integrity;
  }
  return request;
}

function notApplicableValidator(approvedDecisionIds = []) {
  const approved = new Set(approvedDecisionIds);
  return Object.freeze({
    validate(candidate) {
      if (!approved.has(candidate?.decision_id)) {
        return {
          ok: false,
          value: null,
          blockers: [{
            id: 'verification-not-applicable:decision-unapproved',
            artifact: candidate?.decision_id || 'not-applicable'
          }]
        };
      }
      return {
        ok: true,
        value: structuredClone(candidate),
        blockers: []
      };
    }
  });
}

function aggregator(options = {}) {
  return createSixDomainAggregator({
    schemaRegistry: readySchemaRegistry(),
    ...options
  });
}

test('six fixed domains derive stable frozen case, domain, and release pass', () => {
  const request = aggregateRequest({
    verdict: 'green',
    domains: { static: 'green' }
  });
  const before = structuredClone(request);
  const first = aggregator().aggregate(request);
  const second = aggregator().aggregate(structuredClone(request));

  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(first.status, 'pass');
  assert.deepEqual(first.domain_results.map((entry) => entry.domain), SIX_DOMAINS);
  assert.equal(first.case_results[0].status, 'pass');
  assert.equal(first.release.status, 'pass');
  assert.equal(first.id, second.id);
  assert.deepEqual(request, before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.case_results[0].domains), true);
  assert.throws(() => {
    first.release.status = 'fail';
  }, TypeError);
});

test('missing cases, readings, domains, and light or manual-green inputs fail closed', () => {
  const cases = [
    aggregateRequest({ case_ids: [] }),
    aggregateRequest({ readings: [] }),
    aggregateRequest({
      readings: SIX_DOMAINS
        .filter((domain) => domain !== 'sensory')
        .map((domain) => reading(domain))
    }),
    aggregateRequest({
      readings: [],
      verdict: 'green',
      domains: Object.fromEntries(SIX_DOMAINS.map((domain) => [domain, 'green']))
    }),
    aggregateRequest({
      lane: 'light',
      required_domains: ['static', 'unit']
    })
  ];

  for (const request of cases) {
    const result = aggregator().aggregate(request);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.release.status, 'blocked');
    assert.equal(result.domain_results.length, 6);
  }
});

test('only schema-valid, identity-bound readings can contribute to green', () => {
  const forged = aggregateRequest();
  forged.readings[0].change_id = 'other-change';
  forged.readings[1].evidence_ids = [];
  forged.readings.push(structuredClone(forged.readings[2]));

  const result = aggregator().aggregate(forged);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-aggregation:reading-change-mismatch'
  )), true);
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-aggregation:reading-evidence-empty'
  )), true);
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-aggregation:reading-id-duplicate'
  )), true);
});

test('missing, mismatched, or non-intact evidence cannot contribute to green', () => {
  const missing = aggregateRequest();
  missing.evidence = missing.evidence.slice(1);
  missing.integrity.facts.summary.evidence_count -= 1;
  missing.integrity.facts.evidence = missing.integrity.facts.evidence.slice(1);
  const missingResult = aggregator().aggregate(missing);
  assert.equal(missingResult.status, 'blocked');
  assert.equal(missingResult.blockers.some((entry) => (
    entry.id === 'verification-aggregation:reading-evidence-missing'
  )), true);

  const mismatched = aggregateRequest();
  mismatched.evidence[0].attempt_id = 'attempt-other';
  const mismatchResult = aggregator().aggregate(mismatched);
  assert.equal(mismatchResult.status, 'blocked');
  assert.equal(mismatchResult.blockers.some((entry) => (
    entry.id === 'verification-aggregation:reading-evidence-mismatch'
  )), true);

  const broken = aggregateRequest();
  broken.integrity.facts.evidence[0].integrity = 'broken';
  const brokenResult = aggregator().aggregate(broken);
  assert.equal(brokenResult.status, 'blocked');
  assert.equal(brokenResult.blockers.some((entry) => (
    entry.id === 'verification-aggregation:evidence-integrity-blocked'
  )), true);
});

test('external terminal facts provide deterministic flaky and pass-after-fix states', () => {
  for (const status of ['flaky', 'pass_after_fix', 'stale', 'canceled']) {
    const request = aggregateRequest();
    request.policy_facts.terminal_states.push({
      id: `terminal-${status}`,
      case_id: CASE_ID,
      status,
      source_reading_ids: request.readings.map((entry) => entry.id)
    });

    const result = aggregator().aggregate(request);

    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.case_results[0].status, status);
    assert.equal(result.release.status, status);
  }

  const blocked = aggregateRequest();
  blocked.readings[0].verdict = 'blocked';
  blocked.policy_facts.terminal_states.push({
    id: 'terminal-pass-after-fix',
    case_id: CASE_ID,
    status: 'pass_after_fix',
    source_reading_ids: blocked.readings.map((entry) => entry.id)
  });
  assert.equal(aggregator().aggregate(blocked).status, 'blocked');
});

test('a real failed reading is not overwritten by stale or canceled metadata', () => {
  for (const status of ['stale', 'canceled']) {
    const request = aggregateRequest({
      readings: SIX_DOMAINS.map((domain) => reading(domain, {
        verdict: domain === 'unit' ? 'fail' : 'pass'
      }))
    });
    request.policy_facts.terminal_states.push({
      id: `terminal-${status}`,
      case_id: CASE_ID,
      status,
      source_reading_ids: request.readings.map((entry) => entry.id)
    });

    const result = aggregator().aggregate(request);

    assert.equal(result.case_results[0].domains.unit.status, 'fail');
    assert.equal(result.case_results[0].status, 'fail');
    assert.equal(result.release.status, 'fail');
  }
});

test('not-applicable consumes an external validated decision binding only', () => {
  const request = aggregateRequest({
    readings: SIX_DOMAINS
      .filter((domain) => domain !== 'sensory')
      .map((domain) => reading(domain))
  });
  request.policy_facts.not_applicable_decisions.push({
    id: 'na-fact-sensory',
    decision_id: 'na-decision-sensory',
    case_id: CASE_ID,
    domain: 'sensory'
  });

  const unapproved = aggregator().aggregate(request);
  assert.equal(unapproved.ok, false);
  assert.equal(unapproved.status, 'blocked');
  assert.equal(unapproved.blockers.some((entry) => (
    entry.id === 'verification-aggregation:not-applicable-validator-missing'
  )), true);

  const result = aggregator({
    notApplicableDecisionValidator: notApplicableValidator([
      'na-decision-sensory'
    ])
  }).aggregate(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.case_results[0].domains.sensory.status, 'not_applicable');
  assert.equal(result.release.status, 'pass');

  request.readings.push(reading('sensory', {
    id: 'reading-forged-na',
    verdict: 'not_applicable'
  }));
  const evidenceState = evidenceAndIntegrity(request.readings);
  request.evidence = evidenceState.evidence;
  request.integrity = evidenceState.integrity;
  const forged = aggregator({
    notApplicableDecisionValidator: notApplicableValidator([
      'na-decision-sensory'
    ])
  }).aggregate(request);
  assert.equal(forged.ok, false);
  assert.equal(forged.status, 'blocked');
});

test('DecisionEngine emits a schema-valid stable gate bound to aggregate sources', () => {
  const schemaRegistry = readySchemaRegistry();
  const sixDomainAggregator = aggregator();
  const aggregationRequest = aggregateRequest();
  const aggregation = sixDomainAggregator.aggregate(aggregationRequest);
  const engine = createDecisionEngine({
    schemaRegistry,
    aggregator: sixDomainAggregator,
    clock: () => '2026-08-01T03:20:00Z'
  });
  const request = {
    change_id: CHANGE_ID,
    stage: 'release',
    aggregation_request: aggregationRequest,
    evidence_index_version: 7,
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    freshness: {
      status: 'fresh',
      checked_at: '2026-08-01T03:19:00Z',
      reasons: []
    },
    integrity_status: 'intact',
    policy_version: 'verification-policy-v1',
    open_failure_ids: []
  };
  const before = structuredClone(request);
  const first = engine.decide(request);
  const second = engine.decide(structuredClone(request));

  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(first.status, 'pass');
  assert.equal(first.gate.decision, 'pass');
  assert.equal(first.gate.id, second.gate.id);
  assert.deepEqual(first.gate.source_case_ids, [CASE_ID]);
  assert.deepEqual(
    first.gate.source_reading_ids,
    aggregation.source_reading_ids
  );
  assert.equal(schemaRegistry.validate('gate-decision', first.gate).ok, true);
  assert.deepEqual(request, before);
  assert.equal(Object.isFrozen(first.gate), true);
});

test('DecisionEngine rejects a caller-authored aggregate instead of trusting it', () => {
  const schemaRegistry = readySchemaRegistry();
  const engine = createDecisionEngine({
    schemaRegistry,
    aggregator: aggregator(),
    clock: () => '2026-08-01T03:20:00Z'
  });
  const result = engine.decide({
    change_id: CHANGE_ID,
    stage: 'release',
    aggregation: {
      id: 'aggregate-forged',
      change_id: CHANGE_ID,
      ok: true,
      status: 'pass',
      source_case_ids: [],
      source_reading_ids: [],
      blockers: []
    },
    evidence_index_version: 7,
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    freshness: {
      status: 'fresh',
      checked_at: '2026-08-01T03:19:00Z',
      reasons: []
    },
    integrity_status: 'intact',
    policy_version: 'verification-policy-v1',
    open_failure_ids: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.gate, null);
  assert.equal(result.blockers[0].id, 'verification-gate:request-invalid');
});

test('DecisionEngine blocks stale, broken, open-failure, and non-pass aggregates', () => {
  const schemaRegistry = readySchemaRegistry();
  const sixDomainAggregator = aggregator();
  const engine = createDecisionEngine({
    schemaRegistry,
    aggregator: sixDomainAggregator,
    clock: () => '2026-08-01T03:20:00Z'
  });
  const base = {
    change_id: CHANGE_ID,
    stage: 'release',
    aggregation_request: aggregateRequest(),
    evidence_index_version: 7,
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    freshness: {
      status: 'fresh',
      checked_at: '2026-08-01T03:19:00Z',
      reasons: []
    },
    integrity_status: 'intact',
    policy_version: 'verification-policy-v1',
    open_failure_ids: []
  };
  const requests = [
    { ...base, freshness: { ...base.freshness, status: 'stale' } },
    { ...base, integrity_status: 'broken' },
    { ...base, open_failure_ids: ['failure-open'] },
    {
      ...base,
      aggregation_request: aggregateRequest({
        readings: SIX_DOMAINS.map((domain) => reading(domain, {
          verdict: domain === 'unit' ? 'fail' : 'pass'
        }))
      })
    }
  ];

  for (const request of requests) {
    const result = engine.decide(request);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.gate.decision, 'block');
    assert.equal(schemaRegistry.validate('gate-decision', result.gate).ok, true);
  }
});
