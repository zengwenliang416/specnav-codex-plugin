'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const { hashCanonical } = require('./canonical');

const SNAPSHOT_CONTENT_SCHEMA =
  'specnav.verification.case-snapshot-content.v1';

function snapshotContent(value) {
  return {
    schema: SNAPSHOT_CONTENT_SCHEMA,
    change_id: value.change_id,
    requirements_hash: value.requirements_hash,
    acceptance_hash: value.acceptance_hash,
    created_at: value.created_at,
    created_by: value.created_by,
    cases: [...value.cases].sort((left, right) => left.id.localeCompare(right.id))
  };
}

function computeSnapshotHash(value) {
  return hashCanonical(snapshotContent(value));
}

function createCaseSnapshotWriter(options = {}) {
  const { schemaRegistry } = options;
  if (!schemaRegistry || typeof schemaRegistry.validate !== 'function') {
    throw new Error('verification-cases:missing-schema-registry');
  }

  function create(input = {}) {
    const plan = input.plan;
    if (!plan || plan.ok !== true) {
      return deepFreeze({
        ok: false,
        snapshot: null,
        blockers: [{
          id: 'verification-cases:plan-blocked',
          artifact: 'case-snapshot',
          field: '/plan'
        }]
      });
    }
    const requirementsHash = hashCanonical(plan.requirements);
    const acceptanceHash = hashCanonical(plan.acceptance);
    const content = {
      change_id: plan.change_id,
      requirements_hash: requirementsHash,
      acceptance_hash: acceptanceHash,
      created_at: input.createdAt,
      created_by: structuredClone(input.createdBy),
      cases: plan.cases
    };
    const snapshotHash = computeSnapshotHash(content);
    const snapshot = {
      schema: 'specnav.verification.case-snapshot.v1',
      id: `snapshot-${snapshotHash.slice(0, 24)}`,
      change_id: plan.change_id,
      snapshot_hash: snapshotHash,
      cases: [...plan.cases],
      created_at: content.created_at,
      created_by: content.created_by,
      requirements_hash: requirementsHash,
      acceptance_hash: acceptanceHash
    };
    const validation = schemaRegistry.validate('case-snapshot', snapshot, {
      artifactPath: 'memory://case-snapshot'
    });
    if (!validation.ok) {
      return deepFreeze({
        ok: false,
        snapshot: null,
        blockers: validation.blockers
      });
    }
    return deepFreeze({
      ok: true,
      snapshot: validation.value,
      blockers: []
    });
  }

  return Object.freeze({ create });
}

module.exports = {
  SNAPSHOT_CONTENT_SCHEMA,
  computeSnapshotHash,
  createCaseSnapshotWriter,
  snapshotContent
};
