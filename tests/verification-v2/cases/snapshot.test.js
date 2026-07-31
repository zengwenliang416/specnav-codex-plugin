'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  readySchemaRegistry,
  requireCasesModule,
  reviewer,
  sampleCase,
  sources
} = require('./test-helpers');

function createPlan(cases) {
  const { createCasePlanner } = requireCasesModule();
  return createCasePlanner({
    schemaRegistry: readySchemaRegistry()
  }).plan({
    changeId: 'verification-2-0',
    ...sources(),
    cases
  });
}

test('canonical JSON and case normalization are deterministic and immutable', () => {
  const {
    canonicalStringify,
    hashCanonical,
    normalizeCase
  } = requireCasesModule();
  const left = {
    z: 1,
    nested: { b: 2, a: 1 },
    list: [{ y: 2, x: 1 }]
  };
  const right = {
    list: [{ x: 1, y: 2 }],
    nested: { a: 1, b: 2 },
    z: 1
  };
  assert.equal(canonicalStringify(left), canonicalStringify(right));
  assert.equal(hashCanonical(left), hashCanonical(right));
  assert.equal(hashCanonical('A\r\nB'), hashCanonical('A\nB'));
  assert.equal(hashCanonical('\u00e9'), hashCanonical('e\u0301'));
  assert.throws(
    () => hashCanonical({ invalid: Number.NaN }),
    /verification-cases:non-finite-number/
  );
  assert.throws(
    () => hashCanonical({ invalid: new Date() }),
    /verification-cases:non-json-object/
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => hashCanonical(cyclic),
    /verification-cases:cyclic-value/
  );

  const input = sampleCase({
    requirement_ids: ['REQ-02', 'REQ-01'],
    acceptance_ids: ['AC-02', 'AC-01']
  });
  const before = structuredClone(input);
  const normalized = normalizeCase(input);
  assert.deepEqual(normalized.requirement_ids, ['REQ-01', 'REQ-02']);
  assert.deepEqual(normalized.acceptance_ids, ['AC-01', 'AC-02']);
  assert.equal(Object.isFrozen(normalized), true);
  assert.deepEqual(input, before);
});

test('snapshot hash is stable for equivalent input and changes with contract content', () => {
  const { createCaseSnapshotWriter } = requireCasesModule();
  const writer = createCaseSnapshotWriter({
    schemaRegistry: readySchemaRegistry()
  });
  const firstCase = sampleCase();
  const secondCase = sampleCase({
    id: 'case-secondary',
    title: 'Secondary case'
  });
  const planA = createPlan([secondCase, firstCase]);
  const planB = createPlan([firstCase, secondCase]);
  assert.equal(planA.ok, true, JSON.stringify(planA.blockers));
  assert.equal(planB.ok, true, JSON.stringify(planB.blockers));

  const snapshotA = writer.create({
    plan: planA,
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer('reviewer-a')
  });
  const snapshotB = writer.create({
    plan: planB,
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer('reviewer-a')
  });
  assert.equal(snapshotA.ok, true, JSON.stringify(snapshotA.blockers));
  assert.equal(snapshotB.ok, true, JSON.stringify(snapshotB.blockers));
  assert.equal(snapshotA.snapshot.snapshot_hash, snapshotB.snapshot.snapshot_hash);
  assert.equal(snapshotA.snapshot.id, snapshotB.snapshot.id);
  assert.deepEqual(
    snapshotA.snapshot.cases.map((entry) => entry.id),
    ['case-primary', 'case-secondary']
  );
  assert.equal(Object.isFrozen(snapshotA.snapshot), true);

  const changedCase = sampleCase({
    title: 'Changed after review'
  });
  const changedPlan = createPlan([changedCase, secondCase]);
  const changedSnapshot = writer.create({
    plan: changedPlan,
    createdAt: '2026-07-31T02:00:00Z',
    createdBy: reviewer()
  });
  assert.notEqual(
    changedSnapshot.snapshot.snapshot_hash,
    snapshotA.snapshot.snapshot_hash
  );

  const changedProvenance = writer.create({
    plan: planA,
    createdAt: '2026-07-31T00:00:01Z',
    createdBy: reviewer('reviewer-b')
  });
  assert.notEqual(
    changedProvenance.snapshot.snapshot_hash,
    snapshotA.snapshot.snapshot_hash
  );

  const reorderedSteps = structuredClone(firstCase);
  reorderedSteps.steps.push({
    id: 'step-2',
    action: 'Second action',
    expected: 'Second result',
    assertion_ids: ['assertion-1']
  });
  const forward = writer.create({
    plan: createPlan([reorderedSteps, secondCase]),
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  });
  reorderedSteps.steps.reverse();
  const reverse = writer.create({
    plan: createPlan([reorderedSteps, secondCase]),
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  });
  assert.notEqual(
    forward.snapshot.snapshot_hash,
    reverse.snapshot.snapshot_hash
  );
});

test('snapshot writer rejects a failed plan instead of inferring a fallback', () => {
  const { createCaseSnapshotWriter } = requireCasesModule();
  const writer = createCaseSnapshotWriter({
    schemaRegistry: readySchemaRegistry()
  });
  const result = writer.create({
    plan: {
      ok: false,
      blockers: [{ id: 'verification-cases:no-cases' }]
    },
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => entry.id === 'verification-cases:plan-blocked'),
    true
  );
});
