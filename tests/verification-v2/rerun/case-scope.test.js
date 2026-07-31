'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const kernel = require(path.join(ROOT, 'plugins/specnav-verification'));

const ALL_DOMAINS = Object.freeze([
  'facticity',
  'static',
  'unit',
  'redteam',
  'e2e',
  'sensory'
]);

function testCase(id, requirementId, acceptanceId) {
  return {
    id,
    requirement_ids: [requirementId],
    acceptance_ids: [acceptanceId],
    domains: Object.fromEntries(ALL_DOMAINS.map((domain) => [
      domain,
      { mode: 'required' }
    ]))
  };
}

function request() {
  return {
    caseCatalog: {
      id: 'snapshot-rerun',
      change_id: 'change-v2',
      snapshot_hash: 'a'.repeat(64),
      cases: [
        testCase('case-api', 'REQ-api', 'AC-api'),
        testCase('case-baseline', 'REQ-baseline', 'AC-baseline'),
        testCase('case-stale', 'REQ-stale', 'AC-stale'),
        testCase('case-ui', 'REQ-ui', 'AC-ui')
      ]
    },
    caseApproval: {
      id: 'approval-rerun'
    },
    currentRequirements: [
      { id: 'REQ-api' },
      { id: 'REQ-baseline' },
      { id: 'REQ-stale' },
      { id: 'REQ-ui' }
    ],
    currentAcceptance: [
      { id: 'AC-api' },
      { id: 'AC-baseline' },
      { id: 'AC-stale' },
      { id: 'AC-ui' }
    ],
    expectedReviewerId: 'reviewer-1',
    changedFiles: [
      'src/api.js'
    ],
    traceabilityEntries: [
      {
        changed_file: 'src/api.js',
        requirement_refs: ['REQ-api'],
        verification_domains: ['unit']
      },
      {
        changed_file: 'src/ui.js',
        requirement_refs: ['REQ-ui'],
        verification_domains: ['e2e', 'sensory']
      }
    ],
    freshnessFacts: {
      cases: [
        {
          case_id: 'case-api',
          status: 'fresh',
          reasons: []
        },
        {
          case_id: 'case-baseline',
          status: 'fresh',
          reasons: []
        },
        {
          case_id: 'case-stale',
          status: 'stale',
          reasons: ['code_sha:mismatch']
        },
        {
          case_id: 'case-ui',
          status: 'fresh',
          reasons: []
        }
      ]
    },
    repairedCaseIds: ['case-api'],
    mandatoryBaselineCaseIds: ['case-baseline'],
    policyRefs: ['verify/rerun-policy.json#mandatory_baseline_case_ids'],
    codegraphImpact: {
      schema: 'specnav.codegraph.impact.v1',
      generated_at: '2026-07-31T21:30:00Z',
      change_id: 'change-v2',
      source_evidence_ids: ['ev-ui'],
      affected_files: [
        {
          path: 'src/ui.js',
          evidence_refs: ['ev-ui']
        }
      ],
      affected_case_ids: [],
      evidence_refs: ['codegraph/impact-report.json'],
      blockers: []
    }
  };
}

function planner() {
  return kernel.createCaseRerunPlanner({
    caseApprovalValidator: {
      evaluate(input) {
        return {
          ok: input.approval?.id === 'approval-rerun'
            && input.expectedReviewerId === 'reviewer-1',
          status: 'approved-current',
          blockers: []
        };
      }
    }
  });
}

test('public factory returns concrete deterministic case ids and reasons', () => {
  assert.equal(typeof kernel.createCaseRerunPlanner, 'function');

  const result = planner().plan(request());

  assert.equal(result.ok, true);
  assert.equal(result.full_rerun, false);
  assert.deepEqual(result.required_cases, [
    'case-api',
    'case-baseline',
    'case-stale',
    'case-ui'
  ]);
  assert.deepEqual(result.baseline_cases, ['case-baseline']);
  assert.deepEqual(result.repaired_cases, ['case-api']);
  assert.deepEqual(result.stale_cases, ['case-stale']);
  assert.deepEqual(result.impacted_cases, ['case-api', 'case-ui']);
  assert.deepEqual(result.unmapped_changes, []);
  assert.deepEqual(result.domains_to_rerun, ALL_DOMAINS);
  assert.deepEqual(result.reasons_by_case, {
    'case-api': [
      'repaired-case',
      'traceability:changed-file:src/api.js',
      'traceability:requirement:REQ-api'
    ],
    'case-baseline': [
      'policy-baseline'
    ],
    'case-stale': [
      'freshness:code_sha:mismatch'
    ],
    'case-ui': [
      'codegraph:changed-file:src/ui.js',
      'codegraph:evidence:ev-ui'
    ]
  });
  assert.deepEqual(result.cases_to_rerun, result.required_cases.map((caseId) => ({
    case_id: caseId,
    reasons: result.reasons_by_case[caseId]
  })));
  assert.deepEqual(result.codegraph_refs, ['codegraph/impact-report.json']);
  assert.deepEqual(result.policy_refs, [
    'verify/rerun-policy.json#mandatory_baseline_case_ids'
  ]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.blockers, []);
});

test('CodeGraph can map an otherwise unmapped changed file to exact cases', () => {
  const input = request();
  input.changedFiles = ['src/ui.js'];
  input.traceabilityEntries = [];
  input.repairedCaseIds = [];
  input.mandatoryBaselineCaseIds = [];
  input.freshnessFacts.cases = input.freshnessFacts.cases.map((fact) => ({
    ...fact,
    status: 'fresh',
    reasons: []
  }));
  input.codegraphImpact.affected_files[0].case_ids = ['case-ui'];

  const result = planner().plan(input);

  assert.equal(result.ok, true);
  assert.equal(result.full_rerun, false);
  assert.deepEqual(result.required_cases, ['case-ui']);
  assert.deepEqual(result.unmapped_changes, []);
  assert.deepEqual(result.reasons_by_case['case-ui'], [
    'codegraph:changed-file:src/ui.js',
    'codegraph:evidence:ev-ui'
  ]);
});

test('unmapped production changes conservatively select every approved case', () => {
  const input = request();
  input.changedFiles.push('src/unmapped.js');

  const result = planner().plan(input);

  assert.equal(result.ok, true);
  assert.equal(result.full_rerun, true);
  assert.deepEqual(result.unmapped_changes, ['src/unmapped.js']);
  assert.deepEqual(result.required_cases, [
    'case-api',
    'case-baseline',
    'case-stale',
    'case-ui'
  ]);
  for (const caseId of result.required_cases) {
    assert.ok(result.reasons_by_case[caseId].includes(
      'unmapped-change:src/unmapped.js'
    ));
  }
  assert.deepEqual(result.domains_to_rerun, ALL_DOMAINS);
  assert.deepEqual(result.warnings, [
    'unmapped-changes:src/unmapped.js'
  ]);
});

test('CodeGraph cannot remove repaired or mandatory baseline cases', () => {
  const input = request();
  input.changedFiles = [];
  input.traceabilityEntries = [];
  input.freshnessFacts.cases = input.freshnessFacts.cases.map((fact) => ({
    ...fact,
    status: 'fresh',
    reasons: []
  }));
  input.codegraphImpact = {
    schema: 'specnav.codegraph.impact.v1',
    generated_at: '2026-07-31T21:30:00Z',
    change_id: 'change-v2',
    source_evidence_ids: ['ev-empty'],
    affected_files: [],
    affected_case_ids: [],
    excluded_case_ids: ['case-api', 'case-baseline'],
    evidence_refs: ['codegraph/impact-report.json'],
    blockers: []
  };

  const result = planner().plan(input);

  assert.equal(result.ok, true);
  assert.deepEqual(result.required_cases, ['case-api', 'case-baseline']);
  assert.deepEqual(result.reasons_by_case, {
    'case-api': ['repaired-case'],
    'case-baseline': ['policy-baseline']
  });
});

test('unknown case references fail closed without silently shrinking scope', () => {
  const input = request();
  input.traceabilityEntries[0].case_ids = ['case-missing'];

  const result = planner().plan(input);

  assert.equal(result.ok, false);
  assert.equal(result.full_rerun, true);
  assert.deepEqual(result.required_cases, [
    'case-api',
    'case-baseline',
    'case-stale',
    'case-ui'
  ]);
  assert.ok(result.blockers.some((entry) => (
    entry.id === 'verification-rerun:unknown-case-reference'
    && entry.artifact === 'traceability:src/api.js'
    && entry.detail === 'case-missing'
  )));
});

test('malformed CodeGraph impact fails closed and selects all approved cases', () => {
  const input = request();
  input.codegraphImpact = {
    schema: 'specnav.codegraph.impact.v0',
    affected_files: 'src/ui.js'
  };

  const result = planner().plan(input);

  assert.equal(result.ok, false);
  assert.equal(result.full_rerun, true);
  assert.deepEqual(result.required_cases, [
    'case-api',
    'case-baseline',
    'case-stale',
    'case-ui'
  ]);
  assert.ok(result.blockers.some((entry) => (
    entry.id === 'verification-rerun:codegraph-impact-invalid'
  )));
});

test('CodeGraph affected files without an approved case mapping fail closed', () => {
  const input = request();
  input.codegraphImpact.source_evidence_ids = ['ev-unmapped'];
  input.codegraphImpact.affected_files = [{
    path: 'src/unmapped-related.js',
    evidence_refs: ['ev-unmapped']
  }];

  const result = planner().plan(input);

  assert.equal(result.ok, false);
  assert.equal(result.full_rerun, true);
  assert.deepEqual(result.required_cases, [
    'case-api',
    'case-baseline',
    'case-stale',
    'case-ui'
  ]);
  assert.ok(result.blockers.some((entry) => (
    entry.id === 'verification-rerun:codegraph-case-map-missing'
    && entry.detail === 'src/unmapped-related.js'
  )));
});

test('cross-change or unbound CodeGraph evidence fails closed', () => {
  const crossChange = request();
  crossChange.codegraphImpact.change_id = 'other-change';
  const unbound = request();
  unbound.codegraphImpact.affected_files[0].evidence_refs = ['ev-forged'];

  for (const input of [crossChange, unbound]) {
    const result = planner().plan(input);
    assert.equal(result.ok, false);
    assert.equal(result.full_rerun, true);
    assert.ok(result.blockers.some((entry) => (
      entry.id === 'verification-rerun:codegraph-impact-invalid'
    )));
  }
});

test('missing freshness facts fail closed for the unaccounted approved case', () => {
  const input = request();
  input.freshnessFacts.cases = input.freshnessFacts.cases.filter((fact) => (
    fact.case_id !== 'case-stale'
  ));

  const result = planner().plan(input);

  assert.equal(result.ok, false);
  assert.ok(result.required_cases.includes('case-stale'));
  assert.ok(result.reasons_by_case['case-stale'].includes(
    'freshness:fact-missing'
  ));
  assert.ok(result.blockers.some((entry) => (
    entry.id === 'verification-rerun:freshness-fact-missing'
    && entry.artifact === 'case-stale'
  )));
});

test('duplicate catalog ids and hostile input are rejected without throwing', () => {
  const duplicate = request();
  duplicate.caseCatalog.cases.push(structuredClone(
    duplicate.caseCatalog.cases[0]
  ));

  const duplicateResult = planner().plan(duplicate);
  const hostileResult = planner().plan({
    get caseCatalog() {
      throw new Error('hostile getter');
    }
  });

  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.blockers.some((entry) => (
    entry.id === 'verification-rerun:case-catalog-invalid'
  )));
  assert.equal(hostileResult.ok, false);
  assert.deepEqual(hostileResult.required_cases, []);
  assert.deepEqual(hostileResult.blockers, [{
    id: 'verification-rerun:request-invalid',
    artifact: 'rerun-scope',
    detail: 'request-unreadable'
  }]);
});

test('incomplete six-domain assignments fail closed before scope selection', () => {
  const input = request();
  input.caseCatalog.cases[0].domains = {};

  const result = planner().plan(input);

  assert.equal(result.ok, false);
  assert.deepEqual(result.required_cases, []);
  assert.deepEqual(result.blockers, [{
    id: 'verification-rerun:case-catalog-invalid',
    artifact: 'case-catalog',
    detail: 'case-catalog-invalid'
  }]);
});

test('missing or rejected case approval blocks and selects all catalog cases', () => {
  const input = request();
  input.caseApproval = null;
  const rejectingPlanner = kernel.createCaseRerunPlanner({
    caseApprovalValidator: {
      evaluate() {
        return {
          ok: false,
          status: 'blocked',
          blockers: [{
            id: 'verification-cases:approval-missing',
            artifact: 'case-approval',
            field: '/approval'
          }]
        };
      }
    }
  });

  const result = rejectingPlanner.plan(input);

  assert.equal(result.ok, false);
  assert.equal(result.full_rerun, true);
  assert.deepEqual(result.required_cases, [
    'case-api',
    'case-baseline',
    'case-stale',
    'case-ui'
  ]);
  assert.deepEqual(result.blockers, [{
    id: 'verification-cases:approval-missing',
    artifact: 'case-approval',
    field: '/approval'
  }]);
});

test('planner requires an approval validator and never assumes approval', () => {
  assert.throws(
    () => kernel.createCaseRerunPlanner(),
    /verification-rerun:missing-case-approval-validator/
  );
});

test('planning never mutates caller-owned artifacts', () => {
  const input = request();
  const before = structuredClone(input);

  const result = planner().plan(input);

  assert.equal(result.ok, true);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.cases_to_rerun), true);
  assert.equal(Object.isFrozen(result.cases_to_rerun[0]), true);
  assert.equal(Object.isFrozen(result.cases_to_rerun[0].reasons), true);
});
