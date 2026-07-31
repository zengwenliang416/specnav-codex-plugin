'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  readySchemaRegistry,
  requireCasesModule,
  sampleCase,
  sources
} = require('./test-helpers');

test('case planner requires validated sources and complete behavior coverage', () => {
  const { createCasePlanner } = requireCasesModule();
  assert.throws(
    () => createCasePlanner(),
    /verification-cases:missing-schema-registry/
  );

  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });
  const input = {
    changeId: 'verification-2-0',
    ...sources(),
    cases: [sampleCase()]
  };
  const before = structuredClone(input);
  const result = planner.plan(input);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.coverage.requirement_ids, ['REQ-01']);
  assert.deepEqual(result.coverage.acceptance_ids, ['AC-01', 'AC-02']);
  assert.equal(Object.isFrozen(result.cases), true);
  assert.deepEqual(input, before);
});

test('case planner fails closed for empty plans and unresolved source references', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });
  const source = sources();

  const empty = planner.plan({
    changeId: 'verification-2-0',
    ...source,
    cases: []
  });
  assert.equal(empty.ok, false);
  assert.equal(
    empty.blockers.some((entry) => entry.id === 'verification-cases:no-cases'),
    true
  );

  const unresolved = sampleCase({
    requirement_ids: ['REQ-MISSING'],
    acceptance_ids: ['AC-MISSING']
  });
  const result = planner.plan({
    changeId: 'verification-2-0',
    ...source,
    cases: [unresolved]
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-cases:unknown-requirement'
      && entry.related_id === 'REQ-MISSING'
    )),
    true
  );
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-cases:unknown-acceptance'
      && entry.related_id === 'AC-MISSING'
    )),
    true
  );
});

test('case planner rejects uncovered requirements or acceptance assertions', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });
  const result = planner.plan({
    changeId: 'verification-2-0',
    requirements: [
      ...sources().requirements,
      { id: 'REQ-02', statement: 'Second requirement' }
    ],
    acceptance: [
      ...sources().acceptance,
      { id: 'AC-03', statement: 'Second acceptance assertion' }
    ],
    cases: [sampleCase()]
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-cases:requirement-uncovered'
      && entry.related_id === 'REQ-02'
    )),
    true
  );
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-cases:acceptance-uncovered'
      && entry.related_id === 'AC-03'
    )),
    true
  );
});

test('case planner rejects duplicate members, orphan assertions, and evidence policy conflicts', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });
  const invalid = sampleCase();
  invalid.steps.push({
    ...structuredClone(invalid.steps[0]),
    action: 'Duplicate step id'
  });
  invalid.assertions.push({
    ...structuredClone(invalid.assertions[0]),
    id: 'assertion-orphan',
    evidence_kinds: ['api_fact']
  });
  invalid.evidence_policy.allowed_kinds = ['structured_comparison'];
  invalid.evidence_policy.required_kinds = [
    'structured_comparison',
    'api_fact'
  ];

  const result = planner.plan({
    changeId: 'verification-2-0',
    ...sources(),
    cases: [invalid]
  });
  assert.equal(result.ok, false);
  for (const id of [
    'verification-cases:duplicate-step',
    'verification-cases:assertion-without-step',
    'verification-cases:assertion-without-domain',
    'verification-cases:required-evidence-not-allowed',
    'verification-cases:assertion-evidence-not-allowed'
  ]) {
    assert.equal(
      result.blockers.some((entry) => entry.id === id),
      true,
      `${id}: ${JSON.stringify(result.blockers)}`
    );
  }
});

test('case planner rejects unknown assertion references and non-ready cases', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });
  const invalid = sampleCase({ status: 'draft' });
  invalid.steps[0].assertion_ids = ['assertion-missing'];
  invalid.domains.e2e.assertion_ids = ['assertion-missing'];

  const result = planner.plan({
    changeId: 'verification-2-0',
    ...sources(),
    cases: [invalid]
  });
  assert.equal(result.ok, false);
  for (const id of [
    'verification-cases:case-not-ready',
    'verification-cases:unknown-step-assertion',
    'verification-cases:unknown-domain-assertion'
  ]) {
    assert.equal(
      result.blockers.some((entry) => entry.id === id),
      true,
      `${id}: ${JSON.stringify(result.blockers)}`
    );
  }
});

test('case planner rejects duplicate cases and cases from another change', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });
  const duplicate = sampleCase();
  const mismatched = sampleCase({
    change_id: 'another-change'
  });

  const result = planner.plan({
    changeId: 'verification-2-0',
    ...sources(),
    cases: [duplicate, mismatched]
  });

  assert.equal(result.ok, false);
  for (const id of [
    'verification-cases:duplicate-case',
    'verification-cases:case-change-mismatch'
  ]) {
    assert.equal(
      result.blockers.some((entry) => entry.id === id),
      true,
      `${id}: ${JSON.stringify(result.blockers)}`
    );
  }
});

test('case planner rejects duplicate and invalid source ids', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });
  const result = planner.plan({
    changeId: 'verification-2-0',
    requirements: [
      ...sources().requirements,
      { id: 'REQ-01', statement: 'Duplicate requirement.' },
      { id: '', statement: 'Invalid requirement.' }
    ],
    acceptance: [
      ...sources().acceptance,
      { id: 'AC-01', statement: 'Duplicate acceptance assertion.' },
      { id: '  ', statement: 'Invalid acceptance assertion.' }
    ],
    cases: [sampleCase()]
  });

  assert.equal(result.ok, false);
  for (const id of [
    'verification-cases:requirements-duplicate',
    'verification-cases:requirements-id-invalid',
    'verification-cases:acceptance-duplicate',
    'verification-cases:acceptance-id-invalid'
  ]) {
    assert.equal(
      result.blockers.some((entry) => entry.id === id),
      true,
      `${id}: ${JSON.stringify(result.blockers)}`
    );
  }
});

test('case planner returns stable blockers for malformed case records', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });

  for (const malformed of [null, 42, 'not-a-case']) {
    assert.doesNotThrow(() => planner.plan({
      changeId: 'verification-2-0',
      ...sources(),
      cases: [malformed]
    }));
    const result = planner.plan({
      changeId: 'verification-2-0',
      ...sources(),
      cases: [malformed]
    });
    assert.equal(result.ok, false);
    assert.equal(result.blockers.length > 0, true);
    assert.equal(
      result.blockers.some((entry) => (
        typeof entry.id === 'string'
        && entry.id.startsWith('verification-contract:')
      )),
      true,
      JSON.stringify(result.blockers)
    );
  }
});

test('case planner returns stable blockers for malformed source records', () => {
  const { createCasePlanner } = requireCasesModule();
  const planner = createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  });

  for (const kind of ['requirements', 'acceptance']) {
    const input = {
      changeId: 'verification-2-0',
      ...sources(),
      cases: [sampleCase()]
    };
    input[kind] = [null, ...input[kind]];
    assert.doesNotThrow(() => planner.plan(input));
    const result = planner.plan(input);
    assert.equal(result.ok, false);
    assert.equal(
      result.blockers.some((entry) => (
        entry.id === `verification-cases:${kind}-id-invalid`
      )),
      true,
      JSON.stringify(result.blockers)
    );
  }
});
