'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const { canonicalJson, sha256 } = require('../evidence/identity');
const { SIX_DOMAINS } = require('./terminal-state');

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

function blocked(blockers) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    fact: null,
    value: null,
    blockers: stableBlockers(blockers)
  });
}

function approved(fact) {
  const value = deepFreeze(structuredClone(fact));
  return deepFreeze({
    ok: true,
    status: 'approved-current',
    fact: value,
    value,
    blockers: []
  });
}

function uniqueCatalogEntry(values, id, artifact, blockers) {
  const matches = values.filter((entry) => entry?.id === id);
  if (matches.length === 0) {
    blockers.push(blocker(
      'verification-not-applicable:catalog-entry-missing',
      artifact,
      id
    ));
    return null;
  }
  if (matches.length > 1) {
    blockers.push(blocker(
      'verification-not-applicable:catalog-entry-ambiguous',
      artifact,
      id
    ));
    return null;
  }
  return matches[0];
}

function validDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validPolicy(policy, context, now, blockers) {
  if (
    !isRecord(policy)
    || typeof policy.id !== 'string'
    || typeof policy.change_id !== 'string'
    || policy.status !== 'active'
    || !Array.isArray(policy.allowed_domains)
    || !validDate(policy.effective_at)
    || !validDate(policy.updated_at)
    || !validDate(policy.expires_at)
  ) {
    blockers.push(blocker(
      'verification-not-applicable:policy-invalid',
      policy?.id || context.decision.policy_ref
    ));
    return false;
  }
  if (policy.change_id !== context.changeId) {
    blockers.push(blocker(
      'verification-not-applicable:policy-change-mismatch',
      policy.id
    ));
  }
  if (!policy.allowed_domains.includes(context.domain)) {
    blockers.push(blocker(
      'verification-not-applicable:policy-domain-denied',
      policy.id,
      context.domain
    ));
  }
  if (
    Array.isArray(policy.allowed_case_ids)
    && !policy.allowed_case_ids.includes(context.caseId)
  ) {
    blockers.push(blocker(
      'verification-not-applicable:policy-case-denied',
      policy.id,
      context.caseId
    ));
  }
  if (
    Date.parse(policy.effective_at) > Date.parse(context.decision.approved_at)
    || Date.parse(policy.updated_at) > Date.parse(context.decision.approved_at)
  ) {
    blockers.push(blocker(
      'verification-not-applicable:approval-stale',
      policy.id
    ));
  }
  if (
    Date.parse(policy.expires_at) <= Date.parse(now)
    || Date.parse(policy.expires_at) <= Date.parse(context.decision.approved_at)
  ) {
    blockers.push(blocker(
      'verification-not-applicable:policy-expired',
      policy.id
    ));
  }
  return true;
}

function integrityFacts(integrity, evidenceCount, blockers) {
  if (
    !isRecord(integrity)
    || integrity.ok !== true
    || !isRecord(integrity.facts)
    || !isRecord(integrity.facts.summary)
    || !Array.isArray(integrity.facts.evidence)
    || !Array.isArray(integrity.blockers)
    || integrity.blockers.length > 0
  ) {
    blockers.push(blocker(
      'verification-not-applicable:integrity-contract-invalid',
      'evidence-integrity'
    ));
    return new Map();
  }
  if (
    integrity.facts.summary.evidence_count !== evidenceCount
    || integrity.facts.summary.integrity !== 'intact'
    || integrity.facts.summary.freshness !== 'fresh'
  ) {
    blockers.push(blocker(
      'verification-not-applicable:integrity-summary-invalid',
      'evidence-integrity'
    ));
  }
  const values = new Map();
  for (const fact of integrity.facts.evidence) {
    if (
      !isRecord(fact)
      || typeof fact.evidence_id !== 'string'
      || values.has(fact.evidence_id)
    ) {
      blockers.push(blocker(
        'verification-not-applicable:integrity-fact-invalid',
        fact?.evidence_id || 'evidence-integrity'
      ));
      continue;
    }
    values.set(fact.evidence_id, fact);
  }
  return values;
}

function factIsIntact(fact) {
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

function assertionStep(testCase, assertionId) {
  const matches = testCase.steps.filter((step) => (
    step.assertion_ids.includes(assertionId)
  ));
  return matches.length === 1 ? matches[0].id : null;
}

function evidenceIdentity(record) {
  return {
    id: record.id,
    digest: sha256(canonicalJson(record))
  };
}

function createNotApplicableDecisionValidator(options = {}) {
  const {
    schemaRegistry,
    expectedReviewerId,
    testCases,
    evidence,
    integrity,
    policies,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || typeof expectedReviewerId !== 'string'
    || expectedReviewerId.trim() === ''
    || !Array.isArray(testCases)
    || !Array.isArray(evidence)
    || !Array.isArray(policies)
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-not-applicable:config-invalid');
  }
  let trusted;
  try {
    trusted = deepFreeze(structuredClone({
      expectedReviewerId,
      testCases,
      evidence,
      integrity,
      policies
    }));
  } catch {
    throw new Error('verification-not-applicable:config-invalid');
  }

  function currentFact(reference) {
    const blockers = [];
    if (
      !isRecord(reference)
      || typeof reference.change_id !== 'string'
      || typeof reference.case_id !== 'string'
      || !SIX_DOMAINS.includes(reference.domain)
    ) {
      return blocked([
        blocker(
          'verification-not-applicable:request-invalid',
          'not-applicable-reference'
        )
      ]);
    }
    const now = clock();
    if (!validDate(now)) {
      return blocked([
        blocker('verification-not-applicable:clock-invalid', 'clock')
      ]);
    }

    const candidateCase = uniqueCatalogEntry(
      trusted.testCases,
      reference.case_id,
      'test-case',
      blockers
    );
    let testCase = null;
    if (candidateCase) {
      const validation = schemaRegistry.validate('test-case', candidateCase);
      if (!validation.ok) {
        blockers.push(blocker(
          'verification-not-applicable:test-case-invalid',
          reference.case_id,
          validation.blockers
        ));
      } else {
        testCase = validation.value;
      }
    }
    if (!testCase) return blocked(blockers);
    if (testCase.change_id !== reference.change_id) {
      blockers.push(blocker(
        'verification-not-applicable:case-change-mismatch',
        testCase.id
      ));
    }

    const assignment = testCase.domains?.[reference.domain];
    const decision = assignment?.not_applicable;
    if (
      !isRecord(assignment)
      || assignment.mode !== 'not_applicable'
      || !isRecord(decision)
    ) {
      blockers.push(blocker(
        'verification-not-applicable:decision-missing',
        `${testCase.id}:${reference.domain}`
      ));
      return blocked(blockers);
    }
    if (
      decision.reviewer.kind !== 'human'
      || decision.reviewer.id !== trusted.expectedReviewerId
    ) {
      blockers.push(blocker(
        decision.reviewer.kind !== 'human'
          ? 'verification-not-applicable:human-reviewer-required'
          : 'verification-not-applicable:reviewer-mismatch',
        `${testCase.id}:${reference.domain}`
      ));
    }
    if (Date.parse(decision.approved_at) < Date.parse(testCase.created_at)) {
      blockers.push(blocker(
        'verification-not-applicable:approval-stale',
        `${testCase.id}:${reference.domain}`
      ));
    }

    const policy = uniqueCatalogEntry(
      trusted.policies,
      decision.policy_ref,
      'not-applicable-policy',
      blockers
    );
    if (policy) {
      validPolicy(policy, {
        changeId: reference.change_id,
        caseId: reference.case_id,
        domain: reference.domain,
        decision
      }, now, blockers);
    }

    const integrityById = integrityFacts(
      trusted.integrity,
      trusted.evidence.length,
      blockers
    );
    const evidenceById = new Map();
    for (const candidate of trusted.evidence) {
      const validation = schemaRegistry.validate('evidence', candidate);
      if (!validation.ok) {
        blockers.push(blocker(
          'verification-not-applicable:evidence-invalid',
          candidate?.id || 'evidence',
          validation.blockers
        ));
        continue;
      }
      if (evidenceById.has(validation.value.id)) {
        blockers.push(blocker(
          'verification-not-applicable:evidence-ambiguous',
          validation.value.id
        ));
        continue;
      }
      evidenceById.set(validation.value.id, validation.value);
    }
    for (const evidenceId of decision.evidence_ids) {
      const record = evidenceById.get(evidenceId);
      if (!record) {
        blockers.push(blocker(
          'verification-not-applicable:evidence-missing',
          evidenceId
        ));
        continue;
      }
      if (
        record.change_id !== reference.change_id
        || record.case_id !== reference.case_id
        || (
          record.domain !== undefined
          && record.domain !== reference.domain
        )
        || !assignment.assertion_ids.includes(record.assertion_id)
        || assertionStep(testCase, record.assertion_id) !== record.step_id
      ) {
        blockers.push(blocker(
          'verification-not-applicable:evidence-identity-mismatch',
          evidenceId
        ));
      }
      if (Date.parse(record.captured_at) > Date.parse(decision.approved_at)) {
        blockers.push(blocker(
          'verification-not-applicable:evidence-after-approval',
          evidenceId
        ));
      }
      const fact = integrityById.get(evidenceId);
      if (!fact) {
        blockers.push(blocker(
          'verification-not-applicable:evidence-integrity-missing',
          evidenceId
        ));
      } else if (!factIsIntact(fact)) {
        blockers.push(blocker(
          'verification-not-applicable:evidence-integrity-blocked',
          evidenceId,
          {
            integrity: fact.integrity,
            freshness: fact.freshness,
            binding_match: fact.binding_match
          }
        ));
      }
    }

    if (blockers.length > 0 || !policy) return blocked(blockers);
    const caseDigest = sha256(canonicalJson(testCase));
    const policyDigest = sha256(canonicalJson(policy));
    const decisionSemantic = {
      change_id: reference.change_id,
      case_id: reference.case_id,
      domain: reference.domain,
      decision
    };
    const decisionId = `na-decision-${sha256(
      canonicalJson(decisionSemantic)
    )}`;
    const factSemantic = {
      decision_id: decisionId,
      change_id: reference.change_id,
      case_id: reference.case_id,
      domain: reference.domain,
      case_digest: caseDigest,
      policy_digest: policyDigest,
      evidence_ids: [...decision.evidence_ids].sort(),
      evidence_identities: decision.evidence_ids
        .map((evidenceId) => evidenceIdentity(evidenceById.get(evidenceId)))
        .sort((left, right) => left.id.localeCompare(right.id)),
      reviewer_id: decision.reviewer.id,
      approved_at: decision.approved_at,
      policy_ref: decision.policy_ref
    };
    return approved({
      id: `na-fact-${sha256(canonicalJson(factSemantic))}`,
      ...factSemantic
    });
  }

  function create(reference) {
    return currentFact(reference);
  }

  function validate(candidate) {
    let input;
    try {
      input = structuredClone(candidate);
    } catch {
      return blocked([
        blocker(
          'verification-not-applicable:request-invalid',
          'not-applicable-fact'
        )
      ]);
    }
    const current = currentFact(input);
    if (!current.ok) return current;
    if (canonicalJson(input) !== canonicalJson(current.fact)) {
      return blocked([
        blocker(
          'verification-not-applicable:fact-mismatch',
          input?.id || 'not-applicable-fact'
        )
      ]);
    }
    return current;
  }

  return Object.freeze({ create, validate });
}

module.exports = {
  createNotApplicableDecisionValidator
};
