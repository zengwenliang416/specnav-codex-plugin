'use strict';

const { makeBlocker } = require('./reference-utils');
const {
  addCaseMemberBinding
} = require('./case-member-binding-validator');
const {
  addReadingEvidenceBindings
} = require('./reading-evidence-binding-validator');

const READING_IDENTITY_FIELDS = Object.freeze([
  'case_id',
  'code_sha',
  'test_sha'
]);
const EVIDENCE_IDENTITY_FIELDS = Object.freeze([
  'case_id',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]);

function addArtifactRunBinding(graph, entityType, entity, collector) {
  collector.addMismatch({
    entityType,
    entityId: entity.id,
    field: 'run_id',
    expected: graph.run.id,
    actual: entity.run_id,
    relatedEntityType: 'verification-run',
    relatedEntityId: graph.run.id
  });
}

function addArtifactAttemptBindings(options) {
  const {
    entityType,
    entity,
    identityFields,
    attemptLookup,
    collector
  } = options;
  const attempt = attemptLookup.get(entity.attempt_id);
  if (!attempt) {
    collector.add(makeBlocker({
      entityType,
      entityId: entity.id,
      field: '/attempt_id',
      expected: [...attemptLookup.keys()].sort(),
      actual: entity.attempt_id,
      related_entity_type: 'attempt'
    }));
    return;
  }

  for (const field of identityFields) {
    collector.addMismatch({
      entityType,
      entityId: entity.id,
      field,
      expected: attempt[field],
      actual: entity[field],
      relatedEntityType: 'attempt',
      relatedEntityId: attempt.id
    });
  }
}

function addAttemptOwnedArtifactBindings(options) {
  const {
    graph,
    entityType,
    entity,
    identityFields,
    caseLookup,
    attemptLookup,
    collector
  } = options;
  addArtifactRunBinding(graph, entityType, entity, collector);
  addArtifactAttemptBindings({
    entityType,
    entity,
    identityFields,
    attemptLookup,
    collector
  });
  addCaseMemberBinding(
    entityType,
    entity,
    caseLookup.get(entity.case_id),
    collector
  );
}

function addReadingBindings(
  graph,
  caseLookup,
  attemptLookup,
  evidenceLookup,
  collector
) {
  for (const reading of graph.readings) {
    addAttemptOwnedArtifactBindings({
      graph,
      entityType: 'reading',
      entity: reading,
      identityFields: READING_IDENTITY_FIELDS,
      caseLookup,
      attemptLookup,
      collector
    });
    addReadingEvidenceBindings(reading, evidenceLookup, collector);
  }
}

function addEvidenceBindings(graph, caseLookup, attemptLookup, collector) {
  for (const evidence of graph.evidence) {
    addAttemptOwnedArtifactBindings({
      graph,
      entityType: 'evidence',
      entity: evidence,
      identityFields: EVIDENCE_IDENTITY_FIELDS,
      caseLookup,
      attemptLookup,
      collector
    });
  }
}

function addArtifactBindings(
  graph,
  caseLookup,
  attemptLookup,
  evidenceLookup,
  collector
) {
  addReadingBindings(
    graph,
    caseLookup,
    attemptLookup,
    evidenceLookup,
    collector
  );
  addEvidenceBindings(graph, caseLookup, attemptLookup, collector);
}

module.exports = {
  addArtifactBindings
};
