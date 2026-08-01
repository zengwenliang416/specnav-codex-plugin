'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const { canonicalJson, sha256 } = require('../evidence/identity');
const {
  SIX_DOMAINS,
  TERMINAL_STATES,
  applyCaseTerminalFact,
  strongestTerminalState
} = require('./terminal-state');

const CASE_FACT_STATES = new Set([
  'blocked',
  'canceled',
  'fail',
  'flaky',
  'pass_after_fix',
  'stale'
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function stableUnique(values) {
  return [...new Set(values)].sort();
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

function stableId(prefix, value) {
  return `${prefix}-${sha256(canonicalJson(value))}`;
}

function readingEvidenceMismatchFields(reading, evidence) {
  return [
    'change_id',
    'run_id',
    'case_id',
    'attempt_id',
    'step_id',
    'assertion_id',
    'code_sha',
    'test_sha'
  ].filter((field) => reading[field] !== evidence[field]).concat(
    evidence.domain !== undefined && evidence.domain !== reading.domain
      ? ['domain']
      : []
  );
}

function intactEvidenceFact(fact) {
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

function validatedEvidenceState(input, schemaRegistry, blockers) {
  if (
    !Array.isArray(input.evidence)
    || !isRecord(input.integrity)
    || input.integrity.ok !== true
    || !isRecord(input.integrity.facts)
    || !isRecord(input.integrity.facts.summary)
    || !Array.isArray(input.integrity.facts.evidence)
    || !Array.isArray(input.integrity.blockers)
    || input.integrity.blockers.length > 0
  ) {
    blockers.push(blocker(
      'verification-aggregation:integrity-contract-invalid',
      input.change_id
    ));
    return {
      evidenceById: new Map(),
      integrityById: new Map()
    };
  }

  const evidenceById = new Map();
  for (const candidate of input.evidence) {
    const validation = schemaRegistry.validate('evidence', candidate);
    if (!validation.ok) {
      blockers.push(blocker(
        'verification-aggregation:evidence-invalid',
        candidate?.id || 'evidence',
        validation.blockers
      ));
      continue;
    }
    const evidence = validation.value;
    if (evidenceById.has(evidence.id)) {
      blockers.push(blocker(
        'verification-aggregation:evidence-id-duplicate',
        evidence.id
      ));
      continue;
    }
    evidenceById.set(evidence.id, evidence);
  }

  const integrityById = new Map();
  for (const fact of input.integrity.facts.evidence) {
    if (
      !isRecord(fact)
      || typeof fact.evidence_id !== 'string'
      || integrityById.has(fact.evidence_id)
    ) {
      blockers.push(blocker(
        'verification-aggregation:evidence-integrity-invalid',
        fact?.evidence_id || 'evidence-integrity'
      ));
      continue;
    }
    integrityById.set(fact.evidence_id, fact);
  }

  const summary = input.integrity.facts.summary;
  if (
    summary.evidence_count !== evidenceById.size
    || summary.integrity !== 'intact'
    || summary.freshness !== 'fresh'
  ) {
    blockers.push(blocker(
      'verification-aggregation:integrity-summary-invalid',
      input.change_id,
      summary
    ));
  }

  return { evidenceById, integrityById };
}

function validateReadingEvidence(
  reading,
  evidenceById,
  integrityById,
  blockers
) {
  const readingBlockers = [];
  for (const evidenceId of reading.evidence_ids) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      readingBlockers.push(blocker(
        'verification-aggregation:reading-evidence-missing',
        reading.id,
        evidenceId
      ));
      continue;
    }
    const mismatchFields = readingEvidenceMismatchFields(reading, evidence);
    if (mismatchFields.length > 0) {
      readingBlockers.push(blocker(
        'verification-aggregation:reading-evidence-mismatch',
        reading.id,
        { evidence_id: evidenceId, fields: mismatchFields }
      ));
    }
    const fact = integrityById.get(evidenceId);
    if (!fact) {
      readingBlockers.push(blocker(
        'verification-aggregation:evidence-integrity-missing',
        evidenceId
      ));
    } else if (!intactEvidenceFact(fact)) {
      readingBlockers.push(blocker(
        'verification-aggregation:evidence-integrity-blocked',
        evidenceId,
        {
          integrity: fact.integrity,
          freshness: fact.freshness,
          binding_match: fact.binding_match
        }
      ));
    }
  }
  blockers.push(...readingBlockers);
  return readingBlockers.length === 0;
}

function blockedDomainResults() {
  return SIX_DOMAINS.map((domain) => ({
    id: stableId('domain-verdict', { domain, status: 'blocked' }),
    domain,
    status: 'blocked',
    case_ids: [],
    reading_ids: [],
    evidence_ids: [],
    policy_fact_ids: [],
    blockers: []
  }));
}

function invalidResult(detail) {
  const blockers = [blocker(
    'verification-aggregation:request-invalid',
    'aggregation-request',
    detail
  )];
  const domainResults = blockedDomainResults();
  const result = {
    id: stableId('verification-aggregate', { detail }),
    change_id: null,
    ok: false,
    status: 'blocked',
    case_results: [],
    domain_results: domainResults,
    release: {
      status: 'blocked',
      case_ids: [],
      reading_ids: [],
      evidence_ids: [],
      policy_fact_ids: []
    },
    source_case_ids: [],
    source_reading_ids: [],
    source_policy_fact_ids: [],
    blockers
  };
  return deepFreeze(result);
}

function simplifiedLane(input) {
  const values = [
    input.lane,
    input.mode,
    input.verification_mode
  ].filter((value) => typeof value === 'string');
  return values.some((value) => (
    /(?:light|simplified|fallback)/i.test(value)
  )) || input.light === true || input.simplified === true
    || input.fallback === true;
}

function createSixDomainAggregator(options = {}) {
  const {
    schemaRegistry,
    notApplicableDecisionValidator = null
  } = options;
  if (!schemaRegistry || typeof schemaRegistry.validate !== 'function') {
    throw new Error('verification-aggregation:config-invalid');
  }
  if (
    notApplicableDecisionValidator !== null
    && (
      !isRecord(notApplicableDecisionValidator)
      || typeof notApplicableDecisionValidator.validate !== 'function'
    )
  ) {
    throw new Error('verification-aggregation:config-invalid');
  }

  function aggregate(request) {
    let input;
    try {
      input = structuredClone(request);
    } catch {
      return invalidResult('request-unreadable');
    }
    if (
      !isRecord(input)
      || typeof input.change_id !== 'string'
      || !Array.isArray(input.case_ids)
      || !Array.isArray(input.readings)
    ) {
      return invalidResult('request-shape-invalid');
    }

    const blockers = [];
    if (simplifiedLane(input)) {
      blockers.push(blocker(
        'verification-aggregation:simplified-lane-forbidden',
        input.change_id
      ));
    }
    if (Array.isArray(input.required_domains) && (
      input.required_domains.length !== SIX_DOMAINS.length
      || SIX_DOMAINS.some((domain) => !input.required_domains.includes(domain))
    )) {
      blockers.push(blocker(
        'verification-aggregation:six-domains-required',
        input.change_id
      ));
    }

    const caseIds = stableUnique(input.case_ids.filter((id) => (
      typeof id === 'string' && id.length > 0
    )));
    if (caseIds.length !== input.case_ids.length) {
      blockers.push(blocker(
        'verification-aggregation:case-catalog-invalid',
        input.change_id
      ));
    }
    if (caseIds.length === 0) {
      blockers.push(blocker(
        'verification-aggregation:case-missing',
        input.change_id
      ));
    }
    if (input.readings.length === 0) {
      blockers.push(blocker(
        'verification-aggregation:readings-empty',
        input.change_id
      ));
    }

    const {
      evidenceById,
      integrityById
    } = validatedEvidenceState(input, schemaRegistry, blockers);
    const caseSet = new Set(caseIds);
    const readings = [];
    const readingIds = new Set();
    for (const candidate of input.readings) {
      const validation = schemaRegistry.validate('reading', candidate);
      if (!validation.ok) {
        blockers.push(blocker(
          'verification-aggregation:reading-invalid',
          candidate?.id || 'reading',
          validation.blockers
        ));
        continue;
      }
      const reading = validation.value;
      if (readingIds.has(reading.id)) {
        blockers.push(blocker(
          'verification-aggregation:reading-id-duplicate',
          reading.id
        ));
        continue;
      }
      readingIds.add(reading.id);
      if (reading.change_id !== input.change_id) {
        blockers.push(blocker(
          'verification-aggregation:reading-change-mismatch',
          reading.id
        ));
        continue;
      }
      if (!caseSet.has(reading.case_id)) {
        blockers.push(blocker(
          'verification-aggregation:reading-case-missing',
          reading.id
        ));
        continue;
      }
      if (reading.verdict === 'not_applicable') {
        blockers.push(blocker(
          'verification-aggregation:not-applicable-reading-forbidden',
          reading.id
        ));
        continue;
      }
      if (
        reading.verdict !== 'blocked'
        && reading.evidence_ids.length === 0
      ) {
        blockers.push(blocker(
          'verification-aggregation:reading-evidence-empty',
          reading.id
        ));
        continue;
      }
      if (!validateReadingEvidence(
        reading,
        evidenceById,
        integrityById,
        blockers
      )) {
        continue;
      }
      readings.push(reading);
    }

    const policyFacts = isRecord(input.policy_facts)
      ? input.policy_facts
      : {};
    const notApplicable = Array.isArray(
      policyFacts.not_applicable_decisions
    ) ? policyFacts.not_applicable_decisions : [];
    const terminalFacts = Array.isArray(policyFacts.terminal_states)
      ? policyFacts.terminal_states
      : [];
    const factIds = new Set();
    const naByCell = new Map();
    const terminalByCase = new Map();

    for (const fact of notApplicable) {
      let validatedFact = null;
      if (notApplicableDecisionValidator === null) {
        blockers.push(blocker(
          'verification-aggregation:not-applicable-validator-missing',
          fact?.decision_id || fact?.id || 'not-applicable'
        ));
        continue;
      }
      try {
        const validation = notApplicableDecisionValidator.validate(
          structuredClone(fact)
        );
        if (
          !isRecord(validation)
          || validation.ok !== true
          || !isRecord(validation.value)
        ) {
          blockers.push(blocker(
            'verification-aggregation:not-applicable-decision-unapproved',
            fact?.decision_id || fact?.id || 'not-applicable',
            validation?.blockers || null
          ));
          continue;
        }
        validatedFact = validation.value;
      } catch (error) {
        blockers.push(blocker(
          'verification-aggregation:not-applicable-decision-unapproved',
          fact?.decision_id || fact?.id || 'not-applicable',
          error instanceof Error ? error.message : String(error)
        ));
        continue;
      }
      if (
        !isRecord(validatedFact)
        || typeof validatedFact.id !== 'string'
        || typeof validatedFact.decision_id !== 'string'
        || validatedFact.id !== fact.id
        || validatedFact.decision_id !== fact.decision_id
        || validatedFact.case_id !== fact.case_id
        || validatedFact.domain !== fact.domain
        || !caseSet.has(validatedFact.case_id)
        || !SIX_DOMAINS.includes(validatedFact.domain)
        || factIds.has(validatedFact.id)
      ) {
        blockers.push(blocker(
          'verification-aggregation:not-applicable-fact-invalid',
          validatedFact?.id || fact?.id || 'not-applicable'
        ));
        continue;
      }
      factIds.add(validatedFact.id);
      const key = `${validatedFact.case_id}:${validatedFact.domain}`;
      if (naByCell.has(key)) {
        blockers.push(blocker(
          'verification-aggregation:not-applicable-fact-ambiguous',
          key
        ));
        continue;
      }
      naByCell.set(key, validatedFact);
    }

    const usableReadingIds = new Set(readings.map((entry) => entry.id));
    for (const fact of terminalFacts) {
      const sources = Array.isArray(fact?.source_reading_ids)
        ? stableUnique(fact.source_reading_ids)
        : [];
      if (
        !isRecord(fact)
        || typeof fact.id !== 'string'
        || !caseSet.has(fact.case_id)
        || !CASE_FACT_STATES.has(fact.status)
        || sources.length === 0
        || sources.some((id) => !usableReadingIds.has(id))
        || readings.some((entry) => (
          sources.includes(entry.id) && entry.case_id !== fact.case_id
        ))
        || factIds.has(fact.id)
        || terminalByCase.has(fact.case_id)
      ) {
        blockers.push(blocker(
          'verification-aggregation:terminal-fact-invalid',
          fact?.id || 'terminal-state'
        ));
        continue;
      }
      factIds.add(fact.id);
      terminalByCase.set(fact.case_id, {
        ...fact,
        source_reading_ids: sources
      });
    }

    const readingsByCell = new Map();
    for (const reading of readings) {
      const key = `${reading.case_id}:${reading.domain}`;
      const values = readingsByCell.get(key) || [];
      values.push(reading);
      readingsByCell.set(key, values);
    }

    const caseResults = [];
    for (const caseId of caseIds) {
      const domains = {};
      const caseBlockers = [];
      const terminalFact = terminalByCase.get(caseId);
      for (const domain of SIX_DOMAINS) {
        const key = `${caseId}:${domain}`;
        const cellReadings = (readingsByCell.get(key) || []).sort(
          (left, right) => left.id.localeCompare(right.id)
        );
        const naFact = naByCell.get(key);
        const cellBlockers = [];
        let status;
        if (cellReadings.length > 0 && naFact) {
          status = 'blocked';
          cellBlockers.push(blocker(
            'verification-aggregation:domain-source-ambiguous',
            key
          ));
        } else if (cellReadings.length > 0) {
          status = strongestTerminalState(
            cellReadings.map((entry) => entry.verdict)
          );
          if (terminalFact) {
            status = applyCaseTerminalFact([status], terminalFact.status);
          }
        } else if (naFact) {
          status = 'not_applicable';
        } else {
          status = 'blocked';
          cellBlockers.push(blocker(
            'verification-aggregation:domain-missing',
            key
          ));
        }
        if (!TERMINAL_STATES.includes(status)) status = 'blocked';
        if (status === 'blocked' && cellReadings.some((entry) => (
          entry.verdict === 'blocked'
        ))) {
          cellBlockers.push(blocker(
            'verification-aggregation:required-reading-blocked',
            key
          ));
        }
        caseBlockers.push(...cellBlockers);
        domains[domain] = {
          status,
          reading_ids: cellReadings.map((entry) => entry.id),
          evidence_ids: stableUnique(cellReadings.flatMap(
            (entry) => entry.evidence_ids
          )),
          policy_fact_ids: stableUnique([
            ...(naFact ? [naFact.id] : []),
            ...(terminalFact ? [terminalFact.id] : [])
          ]),
          blockers: stableBlockers(cellBlockers)
        };
      }
      const statuses = SIX_DOMAINS.map((domain) => domains[domain].status);
      let status = strongestTerminalState(statuses);
      if (
        status === 'not_applicable'
        || statuses.every((value) => ['pass', 'not_applicable'].includes(value))
      ) {
        status = statuses.includes('pass') ? 'pass' : 'not_applicable';
      }
      const result = {
        id: '',
        case_id: caseId,
        status,
        domains,
        reading_ids: stableUnique(readings.filter(
          (entry) => entry.case_id === caseId
        ).map((entry) => entry.id)),
        evidence_ids: stableUnique(readings.filter(
          (entry) => entry.case_id === caseId
        ).flatMap((entry) => entry.evidence_ids)),
        policy_fact_ids: stableUnique([
          ...SIX_DOMAINS.flatMap((domain) => domains[domain].policy_fact_ids)
        ]),
        blockers: stableBlockers(caseBlockers)
      };
      result.id = stableId('case-verdict', result);
      caseResults.push(result);
    }

    const domainResults = SIX_DOMAINS.map((domain) => {
      const cells = caseResults.map((entry) => ({
        case_id: entry.case_id,
        ...entry.domains[domain]
      }));
      let status = strongestTerminalState(cells.map((entry) => entry.status));
      if (
        status === 'not_applicable'
        || cells.every((entry) => (
          ['pass', 'not_applicable'].includes(entry.status)
        ))
      ) {
        status = cells.some((entry) => entry.status === 'pass')
          ? 'pass'
          : 'not_applicable';
      }
      const result = {
        id: '',
        domain,
        status,
        case_ids: cells.map((entry) => entry.case_id).sort(),
        reading_ids: stableUnique(cells.flatMap((entry) => entry.reading_ids)),
        evidence_ids: stableUnique(cells.flatMap((entry) => entry.evidence_ids)),
        policy_fact_ids: stableUnique(cells.flatMap(
          (entry) => entry.policy_fact_ids
        )),
        blockers: stableBlockers(cells.flatMap((entry) => entry.blockers))
      };
      result.id = stableId('domain-verdict', result);
      return result;
    });

    const allBlockers = stableBlockers([
      ...blockers,
      ...caseResults.flatMap((entry) => entry.blockers)
    ]);
    let releaseStatus = strongestTerminalState(
      domainResults.map((entry) => entry.status)
    );
    if (domainResults.every((entry) => (
      ['pass', 'not_applicable'].includes(entry.status)
    ))) {
      releaseStatus = domainResults.some((entry) => entry.status === 'pass')
        ? 'pass'
        : 'not_applicable';
    }
    if (allBlockers.length > 0) releaseStatus = 'blocked';

    const sourceReadingIds = stableUnique(readings.map((entry) => entry.id));
    const sourcePolicyFactIds = stableUnique([...factIds]);
    const release = {
      status: releaseStatus,
      case_ids: caseIds,
      reading_ids: sourceReadingIds,
      evidence_ids: stableUnique(readings.flatMap(
        (entry) => entry.evidence_ids
      )),
      policy_fact_ids: sourcePolicyFactIds
    };
    const identity = {
      change_id: input.change_id,
      case_results: caseResults.map((entry) => ({
        case_id: entry.case_id,
        status: entry.status,
        domains: Object.fromEntries(SIX_DOMAINS.map((domain) => [
          domain,
          entry.domains[domain].status
        ]))
      })),
      release,
      blockers: allBlockers
    };
    return deepFreeze({
      id: stableId('verification-aggregate', identity),
      change_id: input.change_id,
      ok: allBlockers.length === 0,
      status: releaseStatus,
      case_results: caseResults,
      domain_results: domainResults,
      release,
      source_case_ids: caseIds,
      source_reading_ids: sourceReadingIds,
      source_policy_fact_ids: sourcePolicyFactIds,
      blockers: allBlockers
    });
  }

  return Object.freeze({ aggregate });
}

module.exports = {
  createSixDomainAggregator
};
