'use strict';

const { makeBlocker } = require('./reference-utils');

function readingEvidenceMismatchFields(reading, evidence) {
  const mismatches = [];
  for (const field of ['run_id', 'case_id', 'attempt_id']) {
    if (reading[field] !== evidence[field]) mismatches.push(field);
  }
  if (reading.step_id !== evidence.step_id) mismatches.push('step_id');
  if (reading.assertion_id !== evidence.assertion_id) {
    mismatches.push('assertion_id');
  }
  return mismatches;
}

function addEvidenceIdentityBlocker(
  reading,
  evidence,
  mismatchFields,
  collector
) {
  collector.add(makeBlocker({
    entityType: 'reading',
    entityId: reading.id,
    field: '/evidence_ids',
    expected: {
      run_id: reading.run_id,
      case_id: reading.case_id,
      attempt_id: reading.attempt_id,
      step_id: reading.step_id,
      assertion_id: reading.assertion_id
    },
    actual: {
      evidence_id: evidence.id,
      run_id: evidence.run_id,
      case_id: evidence.case_id,
      attempt_id: evidence.attempt_id,
      step_id: evidence.step_id,
      assertion_id: evidence.assertion_id
    },
    related_entity_type: 'evidence',
    related_entity_id: evidence.id,
    detail: `evidence identity mismatch: ${mismatchFields.join(',')}`
  }));
}

function addMissingEvidenceBlocker(
  reading,
  evidenceLookup,
  missingEvidenceIds,
  collector
) {
  if (missingEvidenceIds.length === 0) return;
  collector.add(makeBlocker({
    entityType: 'reading',
    entityId: reading.id,
    field: '/evidence_ids',
    expected: [...evidenceLookup.keys()].sort(),
    actual: [...missingEvidenceIds].sort(),
    related_entity_type: 'evidence'
  }));
}

function addReadingEvidenceBindings(reading, evidenceLookup, collector) {
  const missingEvidenceIds = [];
  for (const evidenceId of reading.evidence_ids) {
    const evidence = evidenceLookup.get(evidenceId);
    if (!evidence) {
      missingEvidenceIds.push(evidenceId);
      continue;
    }
    const mismatchFields = readingEvidenceMismatchFields(reading, evidence);
    if (mismatchFields.length > 0) {
      addEvidenceIdentityBlocker(
        reading,
        evidence,
        mismatchFields,
        collector
      );
    }
  }
  addMissingEvidenceBlocker(
    reading,
    evidenceLookup,
    missingEvidenceIds,
    collector
  );
}

module.exports = {
  addReadingEvidenceBindings
};
