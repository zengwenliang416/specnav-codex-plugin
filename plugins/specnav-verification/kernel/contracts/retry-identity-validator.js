'use strict';

const {
  createBlockerCollector,
  entityId,
  makeBlocker
} = require('./reference-utils');

const RETRY_FINGERPRINT_FIELDS = Object.freeze([
  'run_id',
  'change_id',
  'case_id',
  'case_snapshot_hash',
  'runner',
  'code_sha',
  'test_sha',
  'scenario_hash',
  'environment_hash',
  'browser_project',
  'test_data_snapshot',
  'runtime_version',
  'kernel_version'
]);

function retryBlocker(id, retryAttempt, field, expected, actual) {
  return makeBlocker({
    id,
    entityType: 'attempt',
    entityId: entityId(retryAttempt, '<retry>'),
    field: `/${field}`,
    expected,
    actual,
    related_entity_type: 'attempt',
    related_entity_id: retryAttempt?.parent_attempt_id || null
  });
}

function validateRetryIdentityCore(parentAttempt, retryAttempt) {
  const collector = createBlockerCollector();

  if (retryAttempt.kind !== 'retry') {
    collector.add(retryBlocker(
      'verification-contract:retry-kind-required',
      retryAttempt,
      'kind',
      'retry',
      retryAttempt.kind
    ));
    return collector.result();
  }

  if (!retryAttempt.parent_attempt_id) {
    collector.add(retryBlocker(
      'verification-contract:retry-parent-required',
      retryAttempt,
      'parent_attempt_id',
      'existing parent attempt id',
      retryAttempt.parent_attempt_id
    ));
    return collector.result();
  }

  if (
    !parentAttempt
    || retryAttempt.parent_attempt_id !== parentAttempt.id
  ) {
    collector.add(retryBlocker(
      'verification-contract:retry-parent-not-found',
      retryAttempt,
      'parent_attempt_id',
      parentAttempt?.id || 'existing parent attempt id',
      retryAttempt.parent_attempt_id
    ));
    return collector.result();
  }

  const expectedSequence = parentAttempt.sequence + 1;
  if (retryAttempt.sequence !== expectedSequence) {
    collector.add(retryBlocker(
      'verification-contract:retry-sequence-invalid',
      retryAttempt,
      'sequence',
      expectedSequence,
      retryAttempt.sequence
    ));
  }

  for (const field of RETRY_FINGERPRINT_FIELDS) {
    if (retryAttempt[field] === parentAttempt[field]) continue;
    collector.add(retryBlocker(
      'verification-contract:retry-fingerprint-mismatch',
      retryAttempt,
      field,
      parentAttempt[field],
      retryAttempt[field]
    ));
  }

  return collector.result();
}

function createRetryIdentityValidator({ schemaRegistry }) {
  function validateRetryIdentity({ parentAttempt, retryAttempt }) {
    for (const attempt of [parentAttempt, retryAttempt]) {
      const schemaResult = schemaRegistry.validate('attempt', attempt);
      if (!schemaResult.ok) {
        return {
          ok: false,
          blockers: schemaResult.blockers
        };
      }
    }
    return validateRetryIdentityCore(parentAttempt, retryAttempt);
  }

  return validateRetryIdentity;
}

module.exports = {
  RETRY_FINGERPRINT_FIELDS,
  createRetryIdentityValidator,
  validateRetryIdentityCore
};
