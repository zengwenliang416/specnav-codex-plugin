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

function approvedFixture() {
  const {
    createCasePlanner,
    createCaseSnapshotWriter
  } = requireCasesModule();
  const schemaRegistry = readySchemaRegistry();
  const plan = createCasePlanner({ schemaRegistry }).plan({
    changeId: 'verification-2-0',
    ...sources(),
    cases: [sampleCase()]
  });
  const snapshotResult = createCaseSnapshotWriter({ schemaRegistry }).create({
    plan,
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  });
  assert.equal(snapshotResult.ok, true, JSON.stringify(snapshotResult.blockers));
  const snapshot = snapshotResult.snapshot;
  return {
    snapshot,
    currentRequirements: sources().requirements,
    currentAcceptance: sources().acceptance,
    expectedReviewerId: 'reviewer-1',
    approval: {
      schema: 'specnav.verification.case-approval.v1',
      id: 'approval-primary',
      change_id: snapshot.change_id,
      snapshot_id: snapshot.id,
      snapshot_hash: snapshot.snapshot_hash,
      decision: 'approved',
      reviewer: reviewer(),
      decided_at: '2026-07-31T00:01:00Z'
    }
  };
}

test('execution is legal only for an exact explicit human approval', () => {
  const { createCaseApprovalValidator } = requireCasesModule();
  const validator = createCaseApprovalValidator({
    schemaRegistry: readySchemaRegistry()
  });
  const input = approvedFixture();
  const before = structuredClone(input);
  const result = validator.evaluate(input);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.execution_allowed, true);
  assert.equal(result.status, 'approved-current');
  assert.equal(Object.isFrozen(result.approval), true);
  assert.deepEqual(input, before);
  assert.doesNotThrow(() => validator.assertExecutionApproved(input));
});

test('missing, null, or malformed snapshot always blocks execution', () => {
  const { createCaseApprovalValidator } = requireCasesModule();
  const validator = createCaseApprovalValidator({
    schemaRegistry: readySchemaRegistry()
  });
  const base = approvedFixture();

  for (const snapshot of [undefined, null, false, 0, '']) {
    const result = validator.evaluate({
      ...base,
      snapshot
    });
    assert.equal(result.ok, false);
    assert.equal(result.execution_allowed, false);
    assert.equal(result.blockers.length > 0, true);
    if (snapshot === undefined || snapshot === null) {
      assert.equal(
        result.blockers.some((entry) => (
          entry.id === 'verification-cases:snapshot-missing'
        )),
        true,
        JSON.stringify(result.blockers)
      );
    }
    assert.throws(
      () => validator.assertExecutionApproved({ ...base, snapshot }),
      /verification-cases:execution-blocked/
    );
  }
});

test('rejected, service, mismatched, and stale approvals block execution', async (t) => {
  const { createCaseApprovalValidator } = requireCasesModule();
  const validator = createCaseApprovalValidator({
    schemaRegistry: readySchemaRegistry()
  });
  const base = approvedFixture();

  const cases = [
    {
      name: 'missing approval',
      input: { ...base, approval: null },
      blocker: 'verification-cases:approval-missing'
    },
    {
      name: 'rejected approval',
      input: {
        ...base,
        approval: { ...base.approval, decision: 'rejected' }
      },
      blocker: 'verification-cases:approval-rejected'
    },
    {
      name: 'service approval',
      input: {
        ...base,
        approval: {
          ...base.approval,
          reviewer: { id: 'approval-service', kind: 'service' }
        }
      },
      blocker: 'verification-cases:human-approval-required'
    },
    {
      name: 'snapshot id mismatch',
      input: {
        ...base,
        approval: { ...base.approval, snapshot_id: 'snapshot-other' }
      },
      blocker: 'verification-cases:approval-snapshot-mismatch'
    },
    {
      name: 'snapshot hash mismatch',
      input: {
        ...base,
        approval: { ...base.approval, snapshot_hash: 'f'.repeat(64) }
      },
      blocker: 'verification-cases:approval-hash-mismatch'
    },
    {
      name: 'snapshot content changed after approval',
      input: {
        ...base,
        snapshot: {
          ...base.snapshot,
          cases: [{
            ...base.snapshot.cases[0],
            title: 'Changed without a new approval'
          }]
        },
        approval: base.approval
      },
      blocker: 'verification-cases:snapshot-stale'
    },
    {
      name: 'snapshot id is stale',
      input: {
        ...base,
        snapshot: {
          ...base.snapshot,
          id: 'snapshot-stale-id'
        }
      },
      blocker: 'verification-cases:snapshot-id-stale'
    },
    {
      name: 'current requirements are missing',
      input: {
        ...base,
        currentRequirements: []
      },
      blocker: 'verification-cases:current-source-missing'
    },
    {
      name: 'current acceptance is missing',
      input: {
        ...base,
        currentAcceptance: null
      },
      blocker: 'verification-cases:current-source-missing'
    },
    {
      name: 'requirements changed after approval',
      input: {
        ...base,
        currentRequirements: [{
          id: 'REQ-01',
          statement: 'Changed requirement after approval.'
        }]
      },
      blocker: 'verification-cases:requirements-stale'
    },
    {
      name: 'acceptance changed after approval',
      input: {
        ...base,
        currentAcceptance: [{
          id: 'AC-01',
          statement: 'Changed acceptance after approval.'
        }, base.currentAcceptance[1]]
      },
      blocker: 'verification-cases:acceptance-stale'
    },
    {
      name: 'reviewer identity mismatch',
      input: {
        ...base,
        expectedReviewerId: 'reviewer-other'
      },
      blocker: 'verification-cases:approval-principal-mismatch'
    },
    {
      name: 'expected reviewer identity is missing',
      input: {
        ...base,
        expectedReviewerId: ''
      },
      blocker: 'verification-cases:approval-principal-missing'
    },
    {
      name: 'approval predates snapshot',
      input: {
        ...base,
        approval: {
          ...base.approval,
          decided_at: '2026-07-30T23:59:59Z'
        }
      },
      blocker: 'verification-cases:approval-time-invalid'
    },
    {
      name: 'snapshot provenance changed after approval',
      input: {
        ...base,
        snapshot: {
          ...base.snapshot,
          created_by: reviewer('reviewer-other')
        }
      },
      blocker: 'verification-cases:snapshot-stale'
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const result = validator.evaluate(entry.input);
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.execution_allowed, false);
      assert.equal(
        result.blockers.some((blocker) => blocker.id === entry.blocker),
        true,
        JSON.stringify(result.blockers)
      );
      assert.throws(
        () => validator.assertExecutionApproved(entry.input),
        /verification-cases:execution-blocked/
      );
    });
  }
});
