'use strict';

const { hashCanonical } = require('./canonical');
const { normalizeSourceList } = require('./normalize');
const { computeSnapshotHash } = require('./snapshot-writer');

function approvalBlocker(id, field, options = {}) {
  const value = {
    id,
    artifact: options.artifact || 'case-approval',
    field
  };
  if (options.expected !== undefined) value.expected = options.expected;
  if (options.actual !== undefined) value.actual = options.actual;
  return value;
}

function validateSnapshotIdentity(snapshot, blockers) {
  const currentHash = computeSnapshotHash(snapshot);
  if (currentHash !== snapshot.snapshot_hash) {
    blockers.push(approvalBlocker(
      'verification-cases:snapshot-stale',
      '/snapshot_hash',
      {
        artifact: 'case-snapshot',
        expected: currentHash,
        actual: snapshot.snapshot_hash
      }
    ));
  }
  const expectedId = `snapshot-${currentHash.slice(0, 24)}`;
  if (snapshot.id !== expectedId) {
    blockers.push(approvalBlocker(
      'verification-cases:snapshot-id-stale',
      '/id',
      {
        artifact: 'case-snapshot',
        expected: expectedId,
        actual: snapshot.id
      }
    ));
  }
}

function validateCurrentSources(snapshot, input, blockers) {
  const checks = [
    ['currentRequirements', 'requirements_hash', 'requirements-stale'],
    ['currentAcceptance', 'acceptance_hash', 'acceptance-stale']
  ];
  for (const [inputField, snapshotField, suffix] of checks) {
    if (!Array.isArray(input[inputField]) || input[inputField].length === 0) {
      blockers.push(approvalBlocker(
        'verification-cases:current-source-missing',
        `/${inputField}`,
        { artifact: 'case-snapshot' }
      ));
      continue;
    }
    const actualHash = hashCanonical(normalizeSourceList(
      input[inputField],
      inputField
    ));
    if (actualHash !== snapshot[snapshotField]) {
      blockers.push(approvalBlocker(
        `verification-cases:${suffix}`,
        `/${snapshotField}`,
        {
          artifact: 'case-snapshot',
          expected: snapshot[snapshotField],
          actual: actualHash
        }
      ));
    }
  }
}

function validateApprovalPrincipal(approval, expectedReviewerId, blockers) {
  if (approval.decision !== 'approved') {
    blockers.push(approvalBlocker(
      'verification-cases:approval-rejected',
      '/decision',
      { expected: 'approved', actual: approval.decision }
    ));
  }
  if (approval.reviewer.kind !== 'human') {
    blockers.push(approvalBlocker(
      'verification-cases:human-approval-required',
      '/reviewer/kind',
      { expected: 'human', actual: approval.reviewer.kind }
    ));
  }
  if (typeof expectedReviewerId !== 'string' || !expectedReviewerId.trim()) {
    blockers.push(approvalBlocker(
      'verification-cases:approval-principal-missing',
      '/expectedReviewerId'
    ));
  } else if (approval.reviewer.id !== expectedReviewerId) {
    blockers.push(approvalBlocker(
      'verification-cases:approval-principal-mismatch',
      '/reviewer/id',
      { expected: expectedReviewerId, actual: approval.reviewer.id }
    ));
  }
}

function validateApprovalBindings(approval, snapshot, blockers) {
  if (Date.parse(approval.decided_at) < Date.parse(snapshot.created_at)) {
    blockers.push(approvalBlocker(
      'verification-cases:approval-time-invalid',
      '/decided_at',
      { expected: `>= ${snapshot.created_at}`, actual: approval.decided_at }
    ));
  }
  const bindings = [
    ['change_id', 'verification-cases:approval-change-mismatch'],
    ['id', 'verification-cases:approval-snapshot-mismatch', 'snapshot_id'],
    ['snapshot_hash', 'verification-cases:approval-hash-mismatch']
  ];
  for (const [snapshotField, id, approvalField = snapshotField] of bindings) {
    if (approval[approvalField] !== snapshot[snapshotField]) {
      blockers.push(approvalBlocker(id, `/${approvalField}`, {
        expected: snapshot[snapshotField],
        actual: approval[approvalField]
      }));
    }
  }
}

module.exports = {
  approvalBlocker,
  validateApprovalBindings,
  validateApprovalPrincipal,
  validateCurrentSources,
  validateSnapshotIdentity
};
