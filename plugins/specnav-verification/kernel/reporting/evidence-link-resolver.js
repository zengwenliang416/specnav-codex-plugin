'use strict';

const {
  byId,
  isRecord,
  stableBlockers
} = require('./report-selectors');

function trustedFact(fact) {
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

function evidenceHref(sourcePath) {
  if (
    typeof sourcePath !== 'string'
    || !/^objects\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(sourcePath)
    || sourcePath.includes('//')
    || sourcePath.includes('/./')
    || sourcePath.includes('/../')
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(sourcePath)
    || /[%?#:\\]/.test(sourcePath)
  ) {
    return null;
  }
  return `evidence/${sourcePath}`;
}

function projectEvidence(evidence, fact) {
  const href = evidenceHref(evidence.path);
  const factTrusted = trustedFact(fact);
  const available = factTrusted && href !== null;
  const blockers = [];
  if (!factTrusted) {
    blockers.push({
      id: 'verification-report:evidence-unavailable',
      artifact: evidence.id,
      detail: isRecord(fact)
        ? `${fact.integrity || 'unknown'}:${fact.freshness || 'unknown'}`
        : 'integrity-fact-missing'
    });
  }
  if (href === null) {
    blockers.push({
      id: 'verification-report:evidence-path-unsafe',
      artifact: evidence.id,
      detail: evidence.path
    });
  }
  return {
    projection: {
      id: evidence.id,
      kind: evidence.kind,
      path: href === null ? null : evidence.path,
      href: available ? href : null,
      available,
      integrity: isRecord(fact) && ['intact', 'broken'].includes(fact.integrity)
        ? fact.integrity
        : 'unknown',
      freshness: isRecord(fact)
        && ['fresh', 'stale'].includes(fact.freshness)
        ? fact.freshness
        : 'unknown',
      sha256: evidence.sha256,
      size: evidence.size,
      producer: evidence.producer,
      captured_at: evidence.captured_at,
      run_id: evidence.run_id,
      case_id: evidence.case_id,
      attempt_id: evidence.attempt_id,
      code_sha: evidence.code_sha,
      test_sha: evidence.test_sha,
      redaction: evidence.redaction
    },
    blockers
  };
}

function resolveEvidenceLinks(evidence, integrity) {
  const facts = Array.isArray(integrity?.facts?.evidence)
    ? integrity.facts.evidence
    : [];
  const factsById = new Map();
  const blockers = [];
  for (const fact of facts) {
    if (
      !isRecord(fact)
      || typeof fact.evidence_id !== 'string'
      || factsById.has(fact.evidence_id)
    ) {
      blockers.push({
        id: 'verification-report:integrity-fact-invalid',
        artifact: fact?.evidence_id || 'integrity-fact',
        detail: null
      });
      continue;
    }
    factsById.set(fact.evidence_id, fact);
  }

  const projections = [];
  for (const entry of [...evidence].sort(byId)) {
    const result = projectEvidence(entry, factsById.get(entry.id));
    projections.push(result.projection);
    blockers.push(...result.blockers);
  }
  return {
    evidence: projections,
    blockers: stableBlockers(blockers)
  };
}

module.exports = {
  evidenceHref,
  resolveEvidenceLinks,
  trustedFact
};
