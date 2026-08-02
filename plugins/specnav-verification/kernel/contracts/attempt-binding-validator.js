'use strict';

const { makeBlocker } = require('./reference-utils');
const {
  validateRetryIdentityCore
} = require('./retry-identity-validator');

const RUN_IDENTITY_FIELDS = Object.freeze([
  'change_id',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]);

function addAttemptCaseBinding(
  graph,
  caseLookup,
  attempt,
  testCase,
  collector
) {
  if (testCase && graph.run.case_ids.includes(attempt.case_id)) return;
  collector.add(makeBlocker({
    entityType: 'attempt',
    entityId: attempt.id,
    field: '/case_id',
    expected: graph.run.case_ids
      .filter((caseId) => caseLookup.has(caseId))
      .sort(),
    actual: attempt.case_id,
    related_entity_type: 'case-snapshot',
    related_entity_id: graph.caseSnapshot.id
  }));
}

function addAttemptRunBindings(graph, attempt, collector) {
  const bindings = [
    ['run_id', graph.run.id],
    ['case_snapshot_hash', graph.run.case_snapshot_hash],
    ...RUN_IDENTITY_FIELDS.map((field) => [field, graph.run[field]])
  ];
  for (const [field, expected] of bindings) {
    collector.addMismatch({
      entityType: 'attempt',
      entityId: attempt.id,
      field,
      expected,
      actual: attempt[field],
      relatedEntityType: 'verification-run',
      relatedEntityId: graph.run.id
    });
  }
}

function addAttemptRunnerBindings(attempt, testCase, collector) {
  if (!testCase) return;
  const bindings = [
    ['runner', testCase.runner.kind],
    [
      'browser_project',
      testCase.runner.kind === 'command'
        ? 'none'
        : testCase.runner.browser_project
    ]
  ];
  for (const [field, expected] of bindings) {
    collector.addMismatch({
      entityType: 'attempt',
      entityId: attempt.id,
      field,
      expected,
      actual: attempt[field],
      relatedEntityType: 'test-case',
      relatedEntityId: testCase.id
    });
  }
}

function addAttemptBindings(graph, caseLookup, collector) {
  for (const attempt of graph.attempts) {
    const testCase = caseLookup.get(attempt.case_id);
    addAttemptRunBindings(graph, attempt, collector);
    addAttemptCaseBinding(
      graph,
      caseLookup,
      attempt,
      testCase,
      collector
    );
    addAttemptRunnerBindings(attempt, testCase, collector);
  }
}

function addRetryBindings(graph, attemptLookup, collector) {
  for (const attempt of graph.attempts) {
    if (attempt.kind === 'retry') {
      const parentAttempt = attempt.parent_attempt_id
        ? attemptLookup.get(attempt.parent_attempt_id)
        : null;
      const result = validateRetryIdentityCore(parentAttempt, attempt);
      for (const blocker of result.blockers) collector.add(blocker);
      continue;
    }

    if (
      attempt.parent_attempt_id
      && !attemptLookup.has(attempt.parent_attempt_id)
    ) {
      const externalParentIsBoundByRun = (
        ['retest', 'regression'].includes(attempt.kind)
        && graph.run.kind === attempt.kind
        && graph.run.parent_attempt_id === attempt.parent_attempt_id
        && typeof graph.run.parent_run_id === 'string'
        && graph.run.parent_run_id !== graph.run.id
        && typeof graph.run.origin_run_id === 'string'
        && graph.run.origin_run_id !== graph.run.id
        && typeof graph.run.failure_id === 'string'
      );
      if (externalParentIsBoundByRun) continue;
      collector.add(makeBlocker({
        entityType: 'attempt',
        entityId: attempt.id,
        field: '/parent_attempt_id',
        expected: [...attemptLookup.keys()].sort(),
        actual: attempt.parent_attempt_id,
        related_entity_type: 'attempt'
      }));
    }
  }
}

module.exports = {
  addAttemptBindings,
  addRetryBindings
};
