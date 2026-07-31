'use strict';

const {
  canonicalJson,
  evidenceId
} = require('./identity');
const { evaluateFreshness } = require('./freshness');
const { readEvidenceObject } = require('./object-reader');

const BLOCKER_IDS = Object.freeze({
  'verification-evidence:object-missing':
    'verification-integrity:evidence-missing',
  'verification-evidence:object-hash-mismatch':
    'verification-integrity:evidence-hash-mismatch',
  'verification-evidence:object-size-mismatch':
    'verification-integrity:evidence-size-mismatch',
  'verification-evidence:producer-unrecognized':
    'verification-integrity:evidence-producer-unrecognized',
  'verification-evidence:record-mismatch':
    'verification-integrity:evidence-record-mismatch',
  'verification-evidence:identity-mismatch':
    'verification-integrity:evidence-identity-mismatch',
  'verification-evidence:evidence-not-found':
    'verification-integrity:evidence-record-missing',
  'verification-evidence:object-path-unsafe':
    'verification-integrity:evidence-path-unsafe',
  'verification-evidence:object-read-failed':
    'verification-integrity:evidence-read-failed',
  'verification-evidence:fingerprint-mismatch':
    'verification-integrity:evidence-stale',
  'verification-evidence:freshness-context-incomplete':
    'verification-integrity:current-fingerprints-missing',
  'verification-evidence:source-fingerprint-incomplete':
    'verification-integrity:evidence-source-fingerprint-missing'
});

function resultBlocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function blockerKey(blocker) {
  try {
    return canonicalJson(blocker);
  } catch {
    return JSON.stringify({
      id: 'verification-integrity:check-failed',
      artifact: 'evidence',
      detail: 'blocker-not-serializable'
    });
  }
}

function stableBlockers(blockers) {
  const unique = new Map();
  for (const candidate of Array.isArray(blockers) ? blockers : []) {
    let blocker;
    try {
      blocker = candidate && typeof candidate === 'object'
        ? { ...candidate }
        : resultBlocker(
            'verification-integrity:check-failed',
            'evidence',
            'invalid-blocker'
          );
    } catch {
      blocker = resultBlocker(
        'verification-integrity:check-failed',
        'evidence',
        'invalid-blocker'
      );
    }
    unique.set(blockerKey(blocker), blocker);
  }
  return [...unique.values()].sort((left, right) => (
    blockerKey(left).localeCompare(blockerKey(right))
  ));
}

function identityMetadata(evidence) {
  const metadata = structuredClone(evidence);
  delete metadata.schema;
  delete metadata.id;
  delete metadata.path;
  return metadata;
}

function mappedBlockers(blockers) {
  return stableBlockers((Array.isArray(blockers) ? blockers : []).map(
    (blocker) => {
      try {
        return {
          ...blocker,
          id: BLOCKER_IDS[blocker.id] || blocker.id
        };
      } catch {
        return resultBlocker(
          'verification-integrity:check-failed',
          'evidence',
          'invalid-blocker'
        );
      }
    }
  ));
}

function safeEvidenceId(evidence, fallback = 'evidence') {
  try {
    return typeof evidence?.id === 'string' && evidence.id.length > 0
      ? evidence.id
      : fallback;
  } catch {
    return fallback;
  }
}

function baseEvidenceFact(evidence) {
  return {
    evidence_id: safeEvidenceId(evidence),
    integrity: 'broken',
    freshness: 'unknown',
    exists: false,
    hash_match: false,
    size_match: false,
    producer_recognized: false,
    store_record_match: false,
    binding_match: true,
    path_safe: false
  };
}

function bindingFailuresByEvidence(blockers, evidence) {
  const failedIds = new Set();
  let appliesToAll = false;
  const knownIds = new Set(evidence.map((entry) => safeEvidenceId(entry)));
  for (const blocker of Array.isArray(blockers) ? blockers : []) {
    let relatedId;
    try {
      relatedId = blocker?.related_entity_id;
    } catch {
      appliesToAll = true;
      continue;
    }
    if (typeof relatedId === 'string' && knownIds.has(relatedId)) {
      failedIds.add(relatedId);
    } else {
      appliesToAll = true;
    }
  }
  return { failedIds, appliesToAll };
}

function createEvidenceIntegrityChecker(options = {}) {
  const {
    evidenceStore,
    crossReferenceValidator,
    registeredProducers,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !evidenceStore
    || typeof evidenceStore.getById !== 'function'
    || typeof evidenceStore.resolve !== 'function'
    || !crossReferenceValidator
    || typeof crossReferenceValidator.validateCrossReferences !== 'function'
    || !Array.isArray(registeredProducers)
    || registeredProducers.length === 0
    || registeredProducers.some((value) => (
      typeof value !== 'string' || value.length === 0
    ))
    || new Set(registeredProducers).size !== registeredProducers.length
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-integrity:config-invalid');
  }
  const producers = new Set(registeredProducers);

  function verifyStoredEvidence(graphEvidence, current, bindingMatch, run) {
    const fact = baseEvidenceFact(graphEvidence);
    fact.binding_match = bindingMatch;
    const blockers = [];
    let stored;

    try {
      stored = evidenceStore.getById(fact.evidence_id);
    } catch (error) {
      blockers.push(resultBlocker(
        'verification-integrity:check-failed',
        fact.evidence_id,
        error instanceof Error ? error.message : String(error)
      ));
      return { fact, blockers };
    }
    if (!stored?.ok) {
      blockers.push(...mappedBlockers(stored?.blockers));
      if (blockers.length === 0) {
        blockers.push(resultBlocker(
          'verification-integrity:evidence-missing',
          fact.evidence_id
        ));
      }
      return { fact, blockers: stableBlockers(blockers) };
    }

    let storedRecord;
    try {
      storedRecord = stored.evidence;
      fact.store_record_match =
        canonicalJson(storedRecord) === canonicalJson(graphEvidence);
    } catch {
      fact.store_record_match = false;
    }
    if (!fact.store_record_match) {
      blockers.push(resultBlocker(
        'verification-integrity:evidence-record-mismatch',
        fact.evidence_id
      ));
    }

    try {
      if (evidenceId(identityMetadata(storedRecord)) !== storedRecord.id) {
        fact.store_record_match = false;
        blockers.push(resultBlocker(
          'verification-integrity:evidence-identity-mismatch',
          fact.evidence_id,
          'identity-mismatch'
        ));
      }
    } catch {
      fact.store_record_match = false;
      blockers.push(resultBlocker(
        'verification-integrity:evidence-identity-mismatch',
        fact.evidence_id,
        'identity-invalid'
      ));
    }

    try {
      fact.producer_recognized = producers.has(storedRecord.producer);
    } catch {
      fact.producer_recognized = false;
    }
    if (!fact.producer_recognized) {
      blockers.push(resultBlocker(
        'verification-integrity:evidence-producer-unrecognized',
        fact.evidence_id
      ));
    }

    let resolved;
    try {
      resolved = evidenceStore.resolve(fact.evidence_id);
    } catch (error) {
      blockers.push(resultBlocker(
        'verification-integrity:check-failed',
        fact.evidence_id,
        error instanceof Error ? error.message : String(error)
      ));
    }
    if (!resolved?.ok) {
      const resolutionBlockers = mappedBlockers(resolved?.blockers);
      blockers.push(...resolutionBlockers);
      if (resolutionBlockers.some((blocker) => (
        blocker.id === 'verification-integrity:evidence-path-unsafe'
      ))) {
        fact.path_safe = false;
      }
    } else {
      fact.path_safe = true;
      const objectResult = readEvidenceObject(
        resolved.path,
        storedRecord,
        resolved.pathPolicy
      );
      const objectBlockers = mappedBlockers(objectResult.blockers);
      blockers.push(...objectBlockers);
      const bytesRead = Buffer.isBuffer(objectResult.bytes);
      fact.exists = bytesRead;
      fact.path_safe = bytesRead
        && !objectBlockers.some((blocker) => (
          blocker.id === 'verification-integrity:evidence-path-unsafe'
        ));
      fact.hash_match = bytesRead
        && !objectBlockers.some((blocker) => (
          blocker.id === 'verification-integrity:evidence-hash-mismatch'
        ));
      fact.size_match = bytesRead
        && !objectBlockers.some((blocker) => (
          blocker.id === 'verification-integrity:evidence-size-mismatch'
        ));
    }

    let freshnessSource;
    try {
      freshnessSource = {
        ...storedRecord,
        case_snapshot_hash: run?.case_snapshot_hash
      };
    } catch {
      freshnessSource = null;
    }
    const freshnessResult = evaluateFreshness(
      freshnessSource,
      current,
      clock
    );
    blockers.push(...mappedBlockers(freshnessResult.blockers));
    fact.freshness = freshnessResult.freshness.status;
    if (fact.exists && fact.path_safe && fact.hash_match && fact.size_match) {
      fact.integrity = !fact.binding_match || blockers.some((blocker) => (
        ![
          'verification-integrity:evidence-stale',
          'verification-integrity:current-fingerprints-missing'
        ].includes(blocker.id)
      ))
        ? 'broken'
        : 'intact';
    } else if (!fact.exists) {
      fact.integrity = 'missing';
    }

    return {
      fact,
      blockers: stableBlockers(blockers)
    };
  }

  function invalidResult(detail) {
    const blockers = [resultBlocker(
      'verification-integrity:request-invalid',
      'verification-graph',
      detail
    )];
    return {
      ok: false,
      facts: {
        summary: {
          evidence_count: 0,
          integrity: 'broken',
          freshness: 'unknown'
        },
        evidence: []
      },
      blockers
    };
  }

  function checkIntegrity(request) {
    let graph;
    let current;
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return invalidResult('request-invalid');
      }
      graph = structuredClone({
        activeChangeId: request.activeChangeId,
        caseSnapshot: request.caseSnapshot,
        run: request.run,
        attempts: request.attempts,
        readings: request.readings,
        evidence: request.evidence
      });
      current = structuredClone(request.currentFingerprints);
      if (!Array.isArray(graph.evidence)) {
        return invalidResult('evidence-invalid');
      }
    } catch {
      return invalidResult('request-unreadable');
    }

    const blockers = [];
    if (graph.evidence.length === 0) {
      blockers.push(resultBlocker(
        'verification-integrity:evidence-empty',
        'verification-graph'
      ));
    }

    let crossReferences;
    try {
      const candidate = structuredClone(
        crossReferenceValidator.validateCrossReferences(graph)
      );
      if (
        !candidate
        || typeof candidate !== 'object'
        || Array.isArray(candidate)
        || typeof candidate.ok !== 'boolean'
        || !Array.isArray(candidate.blockers)
      ) {
        throw new Error('cross-reference-result-invalid');
      }
      const consistent = candidate.ok === (candidate.blockers.length === 0);
      crossReferences = consistent
        ? candidate
        : {
            ok: false,
            blockers: [
              ...candidate.blockers,
              resultBlocker(
                'verification-contract:cross-reference-check-failed',
                'verification-graph',
                'cross-reference-result-inconsistent'
              )
            ]
          };
    } catch (error) {
      crossReferences = {
        ok: false,
        blockers: [resultBlocker(
          'verification-contract:cross-reference-check-failed',
          'verification-graph',
          error instanceof Error ? error.message : String(error)
        )]
      };
    }
    const crossReferenceBlockers = stableBlockers(
      crossReferences?.ok ? [] : crossReferences?.blockers
    );
    blockers.push(...crossReferenceBlockers);
    const bindingFailures = bindingFailuresByEvidence(
      crossReferenceBlockers,
      graph.evidence
    );

    const evidenceResults = [];
    for (const evidence of graph.evidence) {
      const id = safeEvidenceId(evidence);
      const bindingMatch = !bindingFailures.appliesToAll
        && !bindingFailures.failedIds.has(id);
      try {
        evidenceResults.push(
          verifyStoredEvidence(evidence, current, bindingMatch, graph.run)
        );
      } catch (error) {
        evidenceResults.push({
          fact: {
            ...baseEvidenceFact(evidence),
            binding_match: bindingMatch
          },
          blockers: [resultBlocker(
            'verification-integrity:check-failed',
            id,
            error instanceof Error ? error.message : String(error)
          )]
        });
      }
    }
    blockers.push(...evidenceResults.flatMap((result) => result.blockers));

    const facts = evidenceResults.map((result) => result.fact);
    const integrity = facts.length > 0
      && facts.every((fact) => fact.integrity === 'intact')
      ? 'intact'
      : 'broken';
    const freshness = facts.length === 0
      || facts.some((fact) => fact.freshness === 'unknown')
      ? 'unknown'
      : facts.some((fact) => fact.freshness === 'stale')
        ? 'stale'
        : 'fresh';
    const finalBlockers = stableBlockers(blockers);

    return {
      ok: finalBlockers.length === 0
        && integrity === 'intact'
        && freshness === 'fresh',
      facts: {
        summary: {
          evidence_count: facts.length,
          integrity,
          freshness
        },
        evidence: facts
      },
      blockers: finalBlockers
    };
  }

  return Object.freeze({
    checkIntegrity
  });
}

module.exports = {
  BLOCKER_IDS,
  identityMetadata,
  stableBlockers,
  createEvidenceIntegrityChecker
};
