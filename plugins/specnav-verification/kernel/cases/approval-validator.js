'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const {
  approvalBlocker,
  validateApprovalBindings,
  validateApprovalPrincipal,
  validateCurrentSources,
  validateSnapshotIdentity
} = require('./approval-checks');

function validatedArtifact(schemaRegistry, schema, value, path, blockers) {
  if (value === undefined || value === null) return null;
  const validation = schemaRegistry.validate(schema, value, {
    artifactPath: path
  });
  if (!validation.ok) blockers.push(...validation.blockers);
  return validation.value;
}

function createCaseApprovalValidator(options = {}) {
  const { schemaRegistry } = options;
  if (!schemaRegistry || typeof schemaRegistry.validate !== 'function') {
    throw new Error('verification-cases:missing-schema-registry');
  }

  function evaluate(input = {}) {
    const blockers = [];
    if (input.snapshot === undefined || input.snapshot === null) {
      blockers.push(approvalBlocker(
        'verification-cases:snapshot-missing',
        '/snapshot',
        { artifact: 'case-snapshot' }
      ));
    }
    const snapshot = validatedArtifact(
      schemaRegistry,
      'case-snapshot',
      input.snapshot,
      'memory://case-approval/snapshot',
      blockers
    );
    if (snapshot) {
      validateSnapshotIdentity(snapshot, blockers);
      validateCurrentSources(snapshot, input, blockers);
    }
    if (!input.approval) {
      blockers.push(approvalBlocker(
        'verification-cases:approval-missing',
        '/approval'
      ));
    }
    const approval = validatedArtifact(
      schemaRegistry,
      'case-approval',
      input.approval,
      'memory://case-approval/approval',
      blockers
    );
    if (approval) {
      validateApprovalPrincipal(
        approval,
        input.expectedReviewerId,
        blockers
      );
      if (snapshot) validateApprovalBindings(approval, snapshot, blockers);
    }
    const ok = blockers.length === 0;
    return deepFreeze({
      ok,
      execution_allowed: ok,
      status: ok ? 'approved-current' : 'blocked',
      snapshot,
      approval,
      blockers
    });
  }

  function assertExecutionApproved(input) {
    const result = evaluate(input);
    if (!result.ok) {
      const error = new Error('verification-cases:execution-blocked');
      error.blockers = result.blockers;
      throw error;
    }
    return result;
  }

  return Object.freeze({
    assertExecutionApproved,
    evaluate
  });
}

module.exports = {
  createCaseApprovalValidator
};
