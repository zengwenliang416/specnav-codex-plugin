'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURES = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures/positive'
);
const {
  SIX_DOMAINS,
  createNotApplicableDecisionValidator,
  createSixDomainAggregator
} = require('../../../plugins/specnav-verification/kernel/evaluation');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const CHANGE_ID = 'change-v2';
const CASE_ID = 'case-minimal';
const DOMAIN = 'sensory';

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function reviewer(overrides = {}) {
  return {
    id: 'reviewer-1',
    kind: 'human',
    display_name: 'Verification reviewer',
    ...overrides
  };
}

function evidence(overrides = {}) {
  return {
    schema: 'specnav.verification.evidence.v1',
    id: 'evidence-na-sensory',
    kind: 'structured_comparison',
    path: `objects/${'5'.repeat(64)}.json`,
    sha256: '5'.repeat(64),
    size: 42,
    producer: 'command-runner',
    captured_at: '2026-08-01T03:50:00Z',
    change_id: CHANGE_ID,
    run_id: 'run-minimal',
    case_id: CASE_ID,
    attempt_id: 'attempt-1',
    step_id: 'step-1',
    assertion_id: 'assertion-1',
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(40),
    environment_hash: '6'.repeat(64),
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    domain: DOMAIN,
    ...overrides
  };
}

function integrity(record, overrides = {}) {
  return {
    ok: true,
    facts: {
      summary: {
        evidence_count: 1,
        integrity: 'intact',
        freshness: 'fresh'
      },
      evidence: [{
        evidence_id: record.id,
        integrity: 'intact',
        freshness: 'fresh',
        exists: true,
        hash_match: true,
        size_match: true,
        producer_recognized: true,
        store_record_match: true,
        binding_match: true,
        path_safe: true
      }]
    },
    blockers: [],
    ...overrides
  };
}

function policy(overrides = {}) {
  return {
    id: 'policy-na-v1',
    change_id: CHANGE_ID,
    status: 'active',
    allowed_domains: [DOMAIN],
    allowed_case_ids: [CASE_ID],
    effective_at: '2026-08-01T03:00:00Z',
    updated_at: '2026-08-01T03:00:00Z',
    expires_at: '2026-08-02T00:00:00Z',
    ...overrides
  };
}

function testCase(overrides = {}) {
  const value = fixture('test-case.json');
  value.id = CASE_ID;
  value.change_id = CHANGE_ID;
  value.created_at = '2026-08-01T03:30:00Z';
  value.domains[DOMAIN] = {
    mode: 'not_applicable',
    assertion_ids: ['assertion-1'],
    runner: 'command',
    not_applicable: {
      reason: 'This command-only case has no visual sensory surface.',
      evidence_ids: ['evidence-na-sensory'],
      reviewer: reviewer(),
      approved_at: '2026-08-01T04:00:00Z',
      policy_ref: 'policy-na-v1'
    }
  };
  return Object.assign(value, overrides);
}

function validator(overrides = {}) {
  const evidenceRecord = overrides.evidenceRecord || evidence();
  return createNotApplicableDecisionValidator({
    schemaRegistry: readySchemaRegistry(),
    expectedReviewerId: 'reviewer-1',
    testCases: [overrides.testCase || testCase()],
    evidence: [evidenceRecord],
    integrity: overrides.integrity || integrity(evidenceRecord),
    policies: [overrides.policy || policy()],
    clock: () => overrides.now || '2026-08-01T04:10:00Z'
  });
}

function reading(domain) {
  return {
    schema: 'specnav.verification.reading.v1',
    id: `reading-${domain}`,
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
    evidence_ids: [`evidence-${domain}`],
    verdict: 'pass',
    recorded_at: '2026-08-01T04:00:00Z',
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(40)
  };
}

function aggregateEvidence(readings) {
  const records = readings.map((source) => evidence({
    id: source.evidence_ids[0],
    path: `objects/${source.domain.padEnd(64, '7').slice(0, 64)}.json`,
    sha256: '7'.repeat(64),
    domain: source.domain
  }));
  return {
    evidence: records,
    integrity: {
      ok: true,
      facts: {
        summary: {
          evidence_count: records.length,
          integrity: 'intact',
          freshness: 'fresh'
        },
        evidence: records.map((record) => (
          integrity(record).facts.evidence[0]
        ))
      },
      blockers: []
    }
  };
}

test('current human approval creates one stable validator fact', () => {
  const subject = validator();
  const first = subject.create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });
  const second = subject.create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });

  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(first.status, 'approved-current');
  assert.equal(first.fact.id, second.fact.id);
  assert.match(first.fact.id, /^na-fact-[a-f0-9]{64}$/);
  assert.match(first.fact.decision_id, /^na-decision-[a-f0-9]{64}$/);
  assert.deepEqual(first.fact.evidence_ids, ['evidence-na-sensory']);
  assert.equal(first.fact.reviewer_id, 'reviewer-1');
  assert.equal(Object.isFrozen(first.fact), true);
  assert.equal(subject.validate(first.fact).ok, true);
});

test('approved fact is consumed by six-domain aggregation', () => {
  const authority = validator();
  const approval = authority.create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });
  const readings = SIX_DOMAINS
    .filter((domain) => domain !== DOMAIN)
    .map(reading);
  const evidenceState = aggregateEvidence(readings);
  const aggregate = createSixDomainAggregator({
    schemaRegistry: readySchemaRegistry(),
    notApplicableDecisionValidator: authority
  }).aggregate({
    change_id: CHANGE_ID,
    case_ids: [CASE_ID],
    readings,
    ...evidenceState,
    policy_facts: {
      not_applicable_decisions: [approval.fact],
      terminal_states: []
    }
  });

  assert.equal(aggregate.ok, true, JSON.stringify(aggregate.blockers));
  assert.equal(
    aggregate.case_results[0].domains[DOMAIN].status,
    'not_applicable'
  );
  assert.equal(aggregate.release.status, 'pass');
});

test('human identity, policy allowance, and approval freshness fail closed', () => {
  const cases = [
    {
      subject: validator({
        testCase: testCase({
          domains: {
            ...testCase().domains,
            [DOMAIN]: {
              ...testCase().domains[DOMAIN],
              not_applicable: {
                ...testCase().domains[DOMAIN].not_applicable,
                reviewer: reviewer({ kind: 'service' })
              }
            }
          }
        })
      }),
      blocker: 'verification-not-applicable:human-reviewer-required'
    },
    {
      subject: validator({ policy: policy({ allowed_domains: ['unit'] }) }),
      blocker: 'verification-not-applicable:policy-domain-denied'
    },
    {
      subject: validator({
        policy: policy({ updated_at: '2026-08-01T04:05:00Z' })
      }),
      blocker: 'verification-not-applicable:approval-stale'
    },
    {
      subject: validator({
        policy: policy({ expires_at: '2026-08-01T04:05:00Z' })
      }),
      blocker: 'verification-not-applicable:policy-expired'
    }
  ];

  for (const entry of cases) {
    const result = entry.subject.create({
      change_id: CHANGE_ID,
      case_id: CASE_ID,
      domain: DOMAIN
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.blockers.some((item) => (
      item.id === entry.blocker
    )), true, JSON.stringify(result.blockers));
  }
});

test('missing, late, mismatched, or broken evidence blocks approval', () => {
  const lateEvidence = evidence({
    captured_at: '2026-08-01T04:05:00Z'
  });
  const brokenEvidence = evidence();
  const brokenIntegrity = integrity(brokenEvidence);
  brokenIntegrity.facts.evidence[0].integrity = 'broken';
  const cases = [
    {
      subject: createNotApplicableDecisionValidator({
        schemaRegistry: readySchemaRegistry(),
        expectedReviewerId: 'reviewer-1',
        testCases: [testCase()],
        evidence: [],
        integrity: {
          ok: true,
          facts: {
            summary: {
              evidence_count: 0,
              integrity: 'intact',
              freshness: 'fresh'
            },
            evidence: []
          },
          blockers: []
        },
        policies: [policy()],
        clock: () => '2026-08-01T04:10:00Z'
      }),
      blocker: 'verification-not-applicable:evidence-missing'
    },
    {
      subject: validator({ evidenceRecord: lateEvidence }),
      blocker: 'verification-not-applicable:evidence-after-approval'
    },
    {
      subject: validator({
        evidenceRecord: evidence({ case_id: 'case-other' })
      }),
      blocker: 'verification-not-applicable:evidence-identity-mismatch'
    },
    {
      subject: validator({
        evidenceRecord: brokenEvidence,
        integrity: brokenIntegrity
      }),
      blocker: 'verification-not-applicable:evidence-integrity-blocked'
    }
  ];

  for (const entry of cases) {
    const result = entry.subject.create({
      change_id: CHANGE_ID,
      case_id: CASE_ID,
      domain: DOMAIN
    });
    assert.equal(result.ok, false);
    assert.equal(result.blockers.some((item) => (
      item.id === entry.blocker
    )), true, JSON.stringify(result.blockers));
  }
});

test('evidence must belong to an assertion and step owned by the domain', () => {
  const caseWithOtherAssertion = testCase();
  caseWithOtherAssertion.steps.push({
    id: 'step-2',
    action: 'Run an unrelated check',
    expected: 'The unrelated check completes',
    assertion_ids: ['assertion-2']
  });
  caseWithOtherAssertion.assertions.push({
    id: 'assertion-2',
    statement: 'An unrelated assertion passes',
    expected: true,
    oracle: {
      type: 'structured_comparison',
      human_signoff_allowed: false
    },
    evidence_kinds: ['structured_comparison']
  });
  const result = validator({
    testCase: caseWithOtherAssertion,
    evidenceRecord: evidence({
      step_id: 'step-2',
      assertion_id: 'assertion-2'
    })
  }).create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });

  assert.equal(result.ok, false);
  assert.equal(result.blockers.some((item) => (
    item.id === 'verification-not-applicable:evidence-identity-mismatch'
  )), true, JSON.stringify(result.blockers));
});

test('fact identity changes when evidence content changes under the same id', () => {
  const originalEvidence = evidence();
  const original = validator({
    evidenceRecord: originalEvidence
  }).create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });
  const changedEvidence = evidence({
    path: `objects/${'8'.repeat(64)}.json`,
    sha256: '8'.repeat(64),
    size: 84,
    producer: 'playwright-runner'
  });
  const changedAuthority = validator({
    evidenceRecord: changedEvidence,
    integrity: integrity(changedEvidence)
  });

  assert.equal(original.ok, true, JSON.stringify(original.blockers));
  const revalidated = changedAuthority.validate(original.fact);
  assert.equal(revalidated.ok, false);
  assert.equal(revalidated.blockers.some((item) => (
    item.id === 'verification-not-applicable:fact-mismatch'
  )), true, JSON.stringify(revalidated.blockers));
});

test('policy timestamps require an explicit RFC3339 timezone', () => {
  const result = validator({
    policy: policy({
      effective_at: '2026-08-01 03:00:00',
      updated_at: '2026-08-01 03:00:00',
      expires_at: '2026-08-02 00:00:00'
    })
  }).create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });

  assert.equal(result.ok, false);
  assert.equal(result.blockers.some((item) => (
    item.id === 'verification-not-applicable:policy-invalid'
  )), true, JSON.stringify(result.blockers));
});

test('validator snapshots trusted catalogs at construction time', () => {
  const caseCatalog = [testCase()];
  const evidenceRecord = evidence();
  const evidenceCatalog = [evidenceRecord];
  const integrityState = integrity(evidenceRecord);
  const policyCatalog = [policy()];
  const subject = createNotApplicableDecisionValidator({
    schemaRegistry: readySchemaRegistry(),
    expectedReviewerId: 'reviewer-1',
    testCases: caseCatalog,
    evidence: evidenceCatalog,
    integrity: integrityState,
    policies: policyCatalog,
    clock: () => '2026-08-01T04:10:00Z'
  });

  caseCatalog[0].domains[DOMAIN].not_applicable.reason = 'mutated';
  evidenceCatalog[0].sha256 = '9'.repeat(64);
  integrityState.facts.evidence[0].integrity = 'broken';
  policyCatalog[0].allowed_domains = [];

  const result = subject.create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
});

test('forged or stale fact identity cannot be revalidated', () => {
  const current = validator();
  const result = current.create({
    change_id: CHANGE_ID,
    case_id: CASE_ID,
    domain: DOMAIN
  });
  const forged = {
    ...result.fact,
    reviewer_id: 'reviewer-other'
  };

  assert.equal(current.validate(forged).ok, false);
  assert.equal(current.validate(forged).blockers.some((item) => (
    item.id === 'verification-not-applicable:fact-mismatch'
  )), true);

  const changedCase = testCase();
  changedCase.domains[DOMAIN].not_applicable.reason = (
    'The reason changed after the original approval.'
  );
  const stale = validator({ testCase: changedCase }).validate(result.fact);
  assert.equal(stale.ok, false);
  assert.equal(stale.blockers.some((item) => (
    item.id === 'verification-not-applicable:fact-mismatch'
  )), true);
});
