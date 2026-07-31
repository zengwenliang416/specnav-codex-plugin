'use strict';

const { makeBlocker } = require('./reference-utils');

function addActiveChangeBindings(graph, collector) {
  const bindings = [
    ['case-snapshot', graph.caseSnapshot],
    ...graph.caseSnapshot.cases.map((testCase) => ['test-case', testCase]),
    ['verification-run', graph.run],
    ...graph.attempts.map((attempt) => ['attempt', attempt]),
    ...graph.readings.map((reading) => ['reading', reading]),
    ...graph.evidence.map((evidence) => ['evidence', evidence])
  ];
  for (const [entityType, entity] of bindings) {
    collector.addMismatch({
      entityType,
      entityId: entity.id,
      field: 'change_id',
      expected: graph.activeChangeId,
      actual: entity.change_id,
      relatedEntityType: 'change',
      relatedEntityId: graph.activeChangeId
    });
  }
}

function addRunBindings(graph, caseLookup, collector) {
  const { caseSnapshot, run } = graph;
  collector.addMismatch({
    entityType: 'verification-run',
    entityId: run.id,
    field: 'case_snapshot_id',
    expected: caseSnapshot.id,
    actual: run.case_snapshot_id,
    relatedEntityType: 'case-snapshot',
    relatedEntityId: caseSnapshot.id
  });
  collector.addMismatch({
    entityType: 'verification-run',
    entityId: run.id,
    field: 'case_snapshot_hash',
    expected: caseSnapshot.snapshot_hash,
    actual: run.case_snapshot_hash,
    relatedEntityType: 'case-snapshot',
    relatedEntityId: caseSnapshot.id
  });

  const unknownCaseIds = run.case_ids.filter((caseId) => !caseLookup.has(caseId));
  if (unknownCaseIds.length === 0) return;
  collector.add(makeBlocker({
    entityType: 'verification-run',
    entityId: run.id,
    field: '/case_ids',
    expected: [...caseLookup.keys()].sort(),
    actual: [...unknownCaseIds].sort(),
    related_entity_type: 'case-snapshot',
    related_entity_id: caseSnapshot.id
  }));
}

module.exports = {
  addActiveChangeBindings,
  addRunBindings
};
