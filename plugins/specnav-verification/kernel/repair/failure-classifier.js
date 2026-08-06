'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const CLASSIFICATION_POLICY = deepFreeze({
  product_defect: {
    owner: 'development',
    next_action: 'repair_required'
  },
  test_defect: {
    owner: 'development',
    next_action: 'repair_required'
  },
  environment_defect: {
    owner: 'verification',
    next_action: 'retry_allowed'
  },
  flaky: {
    owner: 'verification',
    next_action: 'retry_allowed'
  },
  expected_blocker: {
    owner: 'verification',
    next_action: 'blocked_for_decision'
  },
  requirement_ambiguity: {
    owner: 'core',
    next_action: 'blocked_for_decision'
  }
});

const IDENTITY_FIELDS = Object.freeze([
  'change_id',
  'run_id',
  'case_id',
  'attempt_id'
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function stableBlockers(values) {
  const unique = new Map();
  for (const value of values) {
    const key = canonicalJson(value);
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ));
}

function blocked(values, packet = null) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    packet,
    signals: [],
    blockers: stableBlockers(values)
  });
}

function validDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function sameIdentity(left, right) {
  return IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}

function validIntegrityFact(fact) {
  return isRecord(fact)
    && fact.integrity === 'intact'
    && fact.freshness === 'fresh'
    && fact.exists === true
    && fact.hash_match === true
    && fact.size_match === true
    && fact.producer_recognized === true
    && fact.store_record_match === true
    && fact.binding_match === true
    && fact.path_safe === true;
}

function schemaValue(schemaRegistry, entityType, value) {
  try {
    const result = schemaRegistry.validate(entityType, value);
    return result?.ok === true ? result.value : null;
  } catch {
    return null;
  }
}

function indexedById(values) {
  const index = new Map();
  for (const value of values) {
    const id = value?.id;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(value);
  }
  return index;
}

function readingContentIdentity(reading) {
  return {
    id: reading.id,
    digest: sha256(canonicalJson(reading))
  };
}

function evidenceContentIdentity(evidence) {
  return {
    id: evidence.id,
    digest: sha256(canonicalJson(evidence))
  };
}

function rootCauseCheckValid(check) {
  return isRecord(check)
    && typeof check.id === 'string'
    && check.id.length > 0
    && typeof check.summary === 'string'
    && check.summary.trim().length > 0
    && typeof check.root_cause === 'string'
    && check.root_cause.trim().length > 0
    && Array.isArray(check.failed_assertion_ids)
    && check.failed_assertion_ids.length > 0
    && check.failed_assertion_ids.every((id) => (
      typeof id === 'string' && id.length > 0
    ))
    && new Set(check.failed_assertion_ids).size
      === check.failed_assertion_ids.length;
}

function evidenceMatchesReading(evidence, reading) {
  return sameIdentity(evidence, reading)
    && evidence.code_sha === reading.code_sha
    && evidence.test_sha === reading.test_sha
    && (
      reading.step_id === undefined
      || evidence.step_id === reading.step_id
    )
    && (
      reading.assertion_id === undefined
      || evidence.assertion_id === reading.assertion_id
    );
}

function sameStringSet(left, right) {
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

function duplicateValues(values) {
  return new Set(values).size !== values.length;
}

function packetWithIdentity(fields, identity = fields) {
  return {
    ...fields,
    id: `failure-${sha256(canonicalJson(identity))}`
  };
}

function validateSourceFailure(schemaRegistry, source, identity, readings, evidenceIds) {
  if (source === undefined) return { source: null, blocker: null };
  const value = schemaValue(schemaRegistry, 'failure-packet', source);
  if (
    !value
    || value.classification !== null
    || value.status !== 'open'
    || value.next_action !== 'blocked_for_decision'
    || value.owner !== 'verification'
    || !sameIdentity(value, identity)
    || !sameStringSet(
      new Set(value.reading_ids),
      new Set(readings.map((reading) => reading.id))
    )
    || !sameStringSet(
      new Set(value.evidence_ids),
      new Set(evidenceIds)
    )
  ) {
    return {
      source: null,
      blocker: blocker(
        'verification-failure:source-packet-invalid',
        source?.id || 'source-failure-packet'
      )
    };
  }
  return { source: value, blocker: null };
}

function createFailureClassifier(options = {}) {
  const {
    schemaRegistry,
    rootCauseChecks,
    clock = () => new Date().toISOString(),
    noProgressThreshold = 3
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !Array.isArray(rootCauseChecks)
    || typeof clock !== 'function'
    || !Number.isInteger(noProgressThreshold)
    || noProgressThreshold < 1
  ) {
    throw new Error('verification-failure:config-invalid');
  }

  let trustedChecks;
  try {
    trustedChecks = deepFreeze(structuredClone(rootCauseChecks));
  } catch {
    throw new Error('verification-failure:config-invalid');
  }
  const checksById = indexedById(trustedChecks);

  function classify(request) {
    let input;
    try {
      input = structuredClone(request);
    } catch {
      return blocked([
        blocker('verification-failure:request-invalid', 'failure-request')
      ]);
    }
    if (
      !isRecord(input)
      || !Array.isArray(input.readings)
      || input.readings.length === 0
      || !Array.isArray(input.evidence)
      || !isRecord(input.integrity)
      || typeof input.root_cause_check_id !== 'string'
      || !Number.isInteger(input.no_progress_count)
      || input.no_progress_count < 0
    ) {
      return blocked([
        blocker('verification-failure:request-invalid', 'failure-request')
      ]);
    }

    const validatedReadings = [];
    const readingIds = new Set();
    for (const candidate of input.readings) {
      const reading = schemaValue(schemaRegistry, 'reading', candidate);
      if (
        !reading
        || !['fail', 'blocked'].includes(reading.verdict)
        || readingIds.has(reading.id)
      ) {
        return blocked([
          blocker(
            'verification-failure:reading-invalid',
            candidate?.id || 'reading'
          )
        ]);
      }
      readingIds.add(reading.id);
      validatedReadings.push(reading);
    }

    const identity = validatedReadings[0];
    if (validatedReadings.some((reading) => !sameIdentity(identity, reading))) {
      return blocked([
        blocker(
          'verification-failure:reading-binding-mismatch',
          'failure-readings'
        )
      ]);
    }

    if (validatedReadings.some((reading) => (
      typeof reading.assertion_id !== 'string'
      || reading.assertion_id.length === 0
    ))) {
      return blocked([
        blocker(
          'verification-failure:reading-assertion-missing',
          'failure-readings'
        )
      ]);
    }
    const readingAssertionIds = new Set(
      validatedReadings.map((reading) => reading.assertion_id)
    );

    const checkMatches = checksById.get(input.root_cause_check_id) || [];
    if (checkMatches.length === 0) {
      return blocked([
        blocker(
          'verification-failure:root-cause-check-missing',
          input.root_cause_check_id
        )
      ]);
    }
    if (checkMatches.length !== 1) {
      return blocked([
        blocker(
          'verification-failure:root-cause-check-ambiguous',
          input.root_cause_check_id
        )
      ]);
    }
    const rootCauseCheck = checkMatches[0];
    if (rootCauseCheck.trusted !== true) {
      return blocked([
        blocker(
          'verification-failure:root-cause-check-untrusted',
          rootCauseCheck.id
        )
      ]);
    }
    if (!rootCauseCheckValid(rootCauseCheck)) {
      return blocked([
        blocker(
          'verification-failure:root-cause-check-invalid',
          rootCauseCheck.id
        )
      ]);
    }
    if (!sameIdentity(identity, rootCauseCheck)) {
      return blocked([
        blocker(
          'verification-failure:root-cause-check-binding-mismatch',
          rootCauseCheck.id
        )
      ]);
    }
    const classificationMissing = rootCauseCheck.classification == null;
    if (
      !classificationMissing
      && !Object.hasOwn(
        CLASSIFICATION_POLICY,
        rootCauseCheck.classification
      )
    ) {
      return blocked([
        blocker(
          'verification-failure:classification-invalid',
          rootCauseCheck.id,
          rootCauseCheck.classification
        )
      ]);
    }
    const failedAssertionIds = new Set(rootCauseCheck.failed_assertion_ids);
    if (!sameStringSet(readingAssertionIds, failedAssertionIds)) {
      return blocked([
        blocker(
          'verification-failure:failed-assertion-set-mismatch',
          rootCauseCheck.id
        )
      ]);
    }

    const evidenceIds = [...new Set(
      validatedReadings.flatMap((reading) => reading.evidence_ids)
    )].sort();
    if (evidenceIds.length === 0) {
      return blocked([
        blocker('verification-failure:evidence-missing', 'failure-evidence')
      ]);
    }
    const suppliedEvidenceIds = input.evidence.map((entry) => entry?.id);
    const suppliedEvidenceIdSet = new Set(suppliedEvidenceIds);
    const expectedEvidenceIdSet = new Set(evidenceIds);
    const missingEvidenceId = evidenceIds.find((id) => (
      !suppliedEvidenceIdSet.has(id)
    ));
    if (missingEvidenceId) {
      return blocked([
        blocker('verification-failure:evidence-missing', missingEvidenceId)
      ]);
    }
    if (
      duplicateValues(suppliedEvidenceIds)
      || !sameStringSet(expectedEvidenceIdSet, suppliedEvidenceIdSet)
    ) {
      return blocked([
        blocker(
          'verification-failure:evidence-set-mismatch',
          'failure-evidence'
        )
      ]);
    }
    const evidenceById = indexedById(input.evidence);
    const validatedEvidence = [];
    for (const evidenceId of evidenceIds) {
      const matches = evidenceById.get(evidenceId) || [];
      if (matches.length === 0) {
        return blocked([
          blocker('verification-failure:evidence-missing', evidenceId)
        ]);
      }
      if (matches.length !== 1) {
        return blocked([
          blocker('verification-failure:evidence-invalid', evidenceId)
        ]);
      }
      const record = schemaValue(schemaRegistry, 'evidence', matches[0]);
      if (!record) {
        return blocked([
          blocker('verification-failure:evidence-invalid', evidenceId)
        ]);
      }
      const referencingReadings = validatedReadings.filter((reading) => (
        reading.evidence_ids.includes(evidenceId)
      ));
      if (
        referencingReadings.some((reading) => (
          !evidenceMatchesReading(record, reading)
        ))
      ) {
        return blocked([
          blocker(
            'verification-failure:evidence-binding-mismatch',
            evidenceId
          )
        ]);
      }
      validatedEvidence.push(record);
    }

    if (
      input.integrity.ok !== true
      || !isRecord(input.integrity.facts)
      || !isRecord(input.integrity.facts.summary)
      || !Array.isArray(input.integrity.facts.evidence)
      || !Array.isArray(input.integrity.blockers)
      || input.integrity.blockers.length > 0
      || input.integrity.facts.summary.integrity !== 'intact'
      || input.integrity.facts.summary.freshness !== 'fresh'
    ) {
      return blocked([
        blocker(
          'verification-failure:evidence-integrity-blocked',
          'evidence-integrity'
        )
      ]);
    }
    const integrityEvidenceIds = input.integrity.facts.evidence.map(
      (fact) => fact?.evidence_id
    );
    const integrityEvidenceIdSet = new Set(integrityEvidenceIds);
    const missingIntegrityId = evidenceIds.find((id) => (
      !integrityEvidenceIdSet.has(id)
    ));
    if (missingIntegrityId) {
      return blocked([
        blocker(
          'verification-failure:evidence-integrity-blocked',
          missingIntegrityId
        )
      ]);
    }
    if (
      duplicateValues(integrityEvidenceIds)
      || !sameStringSet(expectedEvidenceIdSet, integrityEvidenceIdSet)
    ) {
      return blocked([
        blocker(
          'verification-failure:integrity-evidence-set-mismatch',
          'evidence-integrity'
        )
      ]);
    }
    if (
      input.integrity.facts.summary.evidence_count
      !== expectedEvidenceIdSet.size
    ) {
      return blocked([
        blocker(
          'verification-failure:integrity-summary-count-mismatch',
          'evidence-integrity'
        )
      ]);
    }
    const integrityById = indexedById(
      input.integrity.facts.evidence.map((fact) => ({
        ...fact,
        id: fact?.evidence_id
      }))
    );
    for (const evidenceId of evidenceIds) {
      const facts = integrityById.get(evidenceId) || [];
      if (facts.length !== 1 || !validIntegrityFact(facts[0])) {
        return blocked([
          blocker(
            'verification-failure:evidence-integrity-blocked',
            evidenceId
          )
        ]);
      }
    }

    const sourceState = validateSourceFailure(
      schemaRegistry,
      input.source_failure_packet,
      identity,
      validatedReadings,
      evidenceIds
    );
    if (sourceState.blocker) return blocked([sourceState.blocker]);
    const sourceFailure = sourceState.source;

    const frozenAt = clock();
    if (!validDate(frozenAt)) {
      return blocked([
        blocker('verification-failure:clock-invalid', 'clock')
      ]);
    }
    const policy = classificationMissing
      ? {
          owner: 'verification',
          status: 'open',
          next_action: 'blocked_for_decision'
        }
      : {
          ...CLASSIFICATION_POLICY[rootCauseCheck.classification],
          status: CLASSIFICATION_POLICY[rootCauseCheck.classification]
            .next_action
        };
    const packetFields = {
      schema: 'specnav.verification.failure-packet.v1',
      change_id: identity.change_id,
      run_id: identity.run_id,
      case_id: identity.case_id,
      attempt_id: identity.attempt_id,
      reading_ids: validatedReadings
        .map((reading) => reading.id)
        .sort(),
      evidence_ids: evidenceIds,
      classification: classificationMissing
        ? null
        : rootCauseCheck.classification,
      status: policy.status,
      next_action: policy.next_action,
      summary: rootCauseCheck.summary,
      root_cause: rootCauseCheck.root_cause,
      failed_assertion_ids: [...failedAssertionIds].sort(),
      owner: policy.owner,
      created_at: sourceFailure?.created_at || frozenAt,
      frozen_at: sourceFailure?.frozen_at || frozenAt
    };
    const packetIdentity = {
      ...packetFields,
      reading_content: validatedReadings
        .map(readingContentIdentity)
        .sort((left, right) => left.id.localeCompare(right.id)),
      evidence_content: validatedEvidence
        .map(evidenceContentIdentity)
        .sort((left, right) => left.id.localeCompare(right.id)),
      root_cause_check_digest: sha256(canonicalJson(rootCauseCheck))
    };
    const packet = sourceFailure
      ? {
          ...packetFields,
          id: sourceFailure.id
        }
      : packetWithIdentity(packetFields, packetIdentity);
    const validatedPacket = schemaValue(
      schemaRegistry,
      'failure-packet',
      packet
    );
    if (!validatedPacket) {
      return blocked([
        blocker(
          'verification-failure:packet-schema-invalid',
          packet.id
        )
      ]);
    }
    if (classificationMissing) {
      return blocked([
        blocker(
          'verification-failure:classification-missing',
          rootCauseCheck.id
        )
      ], validatedPacket);
    }
    const signals = input.no_progress_count >= noProgressThreshold
      ? [{
          kind: 'break_loop_required',
          no_progress_count: input.no_progress_count,
          threshold: noProgressThreshold,
          failure_packet_id: validatedPacket.id
        }]
      : [];
    return deepFreeze({
      ok: true,
      status: 'classified',
      packet: validatedPacket,
      signals,
      blockers: []
    });
  }

  return Object.freeze({ classify });
}

module.exports = {
  CLASSIFICATION_POLICY,
  createFailureClassifier
};
