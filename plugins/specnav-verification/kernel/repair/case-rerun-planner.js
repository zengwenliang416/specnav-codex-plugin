'use strict';

const { deepFreeze } = require('../contracts/schema-registry');

const ALL_DOMAINS = Object.freeze([
  'facticity',
  'static',
  'unit',
  'redteam',
  'e2e',
  'sensory'
]);

function blocker(id, artifact, detail) {
  return { id, artifact, detail };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentity(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim();
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isIdentity);
}

function sorted(values) {
  return Array.from(new Set(values)).sort();
}

function unreadableResult(detail) {
  return deepFreeze({
    ok: false,
    full_rerun: true,
    required_cases: [],
    baseline_cases: [],
    repaired_cases: [],
    impacted_cases: [],
    stale_cases: [],
    cases_to_rerun: [],
    reasons_by_case: {},
    changed_files: [],
    unmapped_changes: [],
    domains_to_rerun: [...ALL_DOMAINS],
    codegraph_refs: [],
    policy_refs: [],
    warnings: [],
    blockers: [
      blocker(
        'verification-rerun:request-invalid',
        'rerun-scope',
        detail
      )
    ]
  });
}

function blockedCatalogResult(cases, sourceBlockers) {
  let blockerList = Array.isArray(sourceBlockers)
    ? sourceBlockers.map((entry) => (
      isRecord(entry) && isIdentity(entry.id)
        ? structuredClone(entry)
        : blocker(
            'verification-rerun:approval-invalid',
            'case-approval',
            null
          )
    ))
    : [
        blocker(
          'verification-rerun:approval-invalid',
          'case-approval',
          null
        )
      ];
  if (blockerList.length === 0) {
    blockerList = [
      blocker(
        'verification-rerun:approval-invalid',
        'case-approval',
        null
      )
    ];
  }
  const blockerReasons = sorted(blockerList.map((entry) => (
    `fail-closed:${entry.id}`
  )));
  const requiredCases = cases.map((testCase) => testCase.id).sort();
  const reasonsByCase = Object.fromEntries(requiredCases.map((caseId) => [
    caseId,
    blockerReasons
  ]));
  return deepFreeze({
    ok: false,
    full_rerun: true,
    required_cases: requiredCases,
    baseline_cases: [],
    repaired_cases: [],
    impacted_cases: [],
    stale_cases: [],
    cases_to_rerun: requiredCases.map((caseId) => ({
      case_id: caseId,
      reasons: reasonsByCase[caseId]
    })),
    reasons_by_case: reasonsByCase,
    changed_files: [],
    unmapped_changes: [],
    domains_to_rerun: [...ALL_DOMAINS],
    codegraph_refs: [],
    policy_refs: [],
    warnings: [],
    blockers: blockerList
  });
}

function catalogState(caseCatalog) {
  if (!isRecord(caseCatalog) || !Array.isArray(caseCatalog.cases)) {
    return { ok: false, cases: [], blocker: 'case-catalog-missing' };
  }
  if (caseCatalog.cases.length === 0) {
    return { ok: false, cases: [], blocker: 'case-catalog-empty' };
  }
  if (
    !isIdentity(caseCatalog.id)
    || !isIdentity(caseCatalog.change_id)
    || typeof caseCatalog.snapshot_hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(caseCatalog.snapshot_hash)
  ) {
    return { ok: false, cases: [], blocker: 'case-catalog-invalid' };
  }

  const cases = [];
  const seen = new Set();
  for (const testCase of caseCatalog.cases) {
    const domainsValid = isRecord(testCase?.domains)
      && ALL_DOMAINS.every((domain) => (
        isRecord(testCase.domains[domain])
        && ['required', 'optional', 'not_applicable'].includes(
          testCase.domains[domain].mode
        )
      ));
    if (
      !isRecord(testCase)
      || !isIdentity(testCase.id)
      || seen.has(testCase.id)
      || !isStringArray(testCase.requirement_ids)
      || !isStringArray(testCase.acceptance_ids)
      || !domainsValid
    ) {
      return { ok: false, cases: [], blocker: 'case-catalog-invalid' };
    }
    seen.add(testCase.id);
    cases.push(testCase);
  }
  return {
    ok: true,
    cases: [...cases].sort((left, right) => left.id.localeCompare(right.id))
  };
}

function addReason(reasons, caseId, reason) {
  if (!reasons.has(caseId)) reasons.set(caseId, new Set());
  reasons.get(caseId).add(reason);
}

function validateCaseReferences(values, source, caseLookup, blockers) {
  if (!isStringArray(values)) {
    blockers.push(blocker(
      'verification-rerun:case-reference-list-invalid',
      source,
      null
    ));
    return [];
  }
  const valid = [];
  for (const caseId of values) {
    if (!caseLookup.has(caseId)) {
      blockers.push(blocker(
        'verification-rerun:unknown-case-reference',
        source,
        caseId
      ));
      continue;
    }
    valid.push(caseId);
  }
  return valid;
}

function caseIndexes(cases) {
  const byId = new Map();
  const byRequirement = new Map();
  const byAcceptance = new Map();
  for (const testCase of cases) {
    byId.set(testCase.id, testCase);
    for (const requirementId of testCase.requirement_ids) {
      if (!byRequirement.has(requirementId)) {
        byRequirement.set(requirementId, new Set());
      }
      byRequirement.get(requirementId).add(testCase.id);
    }
    for (const acceptanceId of testCase.acceptance_ids) {
      if (!byAcceptance.has(acceptanceId)) {
        byAcceptance.set(acceptanceId, new Set());
      }
      byAcceptance.get(acceptanceId).add(testCase.id);
    }
  }
  return { byId, byRequirement, byAcceptance };
}

function addCaseDomains(testCase, domains) {
  for (const domain of ALL_DOMAINS) {
    const assignment = testCase.domains[domain];
    if (
      isRecord(assignment)
      && assignment.mode !== 'not_applicable'
    ) {
      domains.add(domain);
    }
  }
}

function applyTraceability(input, indexes, state) {
  for (const entry of input.traceabilityEntries) {
    if (!isRecord(entry) || !isIdentity(entry.changed_file)) {
      state.blockers.push(blocker(
        'verification-rerun:traceability-entry-invalid',
        'traceability-matrix',
        null
      ));
      continue;
    }
    if (!state.changedFileSet.has(entry.changed_file)) continue;

    const source = `traceability:${entry.changed_file}`;
    const mapped = new Set();
    if (entry.case_ids !== undefined) {
      for (const caseId of validateCaseReferences(
        entry.case_ids,
        source,
        indexes.byId,
        state.blockers
      )) {
        mapped.add(caseId);
        addReason(state.reasons, caseId, `traceability:case:${caseId}`);
      }
    }

    const requirementRefs = entry.requirement_refs === undefined
      ? []
      : entry.requirement_refs;
    if (!isStringArray(requirementRefs)) {
      state.blockers.push(blocker(
        'verification-rerun:traceability-entry-invalid',
        source,
        'requirement_refs'
      ));
    } else {
      for (const requirementId of requirementRefs) {
        for (const caseId of indexes.byRequirement.get(requirementId) || []) {
          mapped.add(caseId);
          addReason(
            state.reasons,
            caseId,
            `traceability:requirement:${requirementId}`
          );
        }
      }
    }

    const acceptanceRefs = entry.acceptance_refs === undefined
      ? []
      : entry.acceptance_refs;
    if (!isStringArray(acceptanceRefs)) {
      state.blockers.push(blocker(
        'verification-rerun:traceability-entry-invalid',
        source,
        'acceptance_refs'
      ));
    } else {
      for (const acceptanceId of acceptanceRefs) {
        for (const caseId of indexes.byAcceptance.get(acceptanceId) || []) {
          mapped.add(caseId);
          addReason(
            state.reasons,
            caseId,
            `traceability:acceptance:${acceptanceId}`
          );
        }
      }
    }

    const domains = entry.verification_domains === undefined
      ? []
      : entry.verification_domains;
    if (
      !Array.isArray(domains)
      || domains.some((domain) => !ALL_DOMAINS.includes(domain))
    ) {
      state.blockers.push(blocker(
        'verification-rerun:traceability-entry-invalid',
        source,
        'verification_domains'
      ));
    } else {
      for (const domain of domains) state.domains.add(domain);
    }

    if (mapped.size === 0) continue;
    state.coveredFiles.add(entry.changed_file);
    for (const caseId of mapped) {
      state.impacted.add(caseId);
      addReason(
        state.reasons,
        caseId,
        `traceability:changed-file:${entry.changed_file}`
      );
    }
  }
}

function codegraphShapeValid(impact, expectedChangeId) {
  return isRecord(impact)
    && impact.schema === 'specnav.codegraph.impact.v1'
    && isIdentity(impact.generated_at)
    && impact.change_id === expectedChangeId
    && isStringArray(impact.source_evidence_ids)
    && impact.source_evidence_ids.length > 0
    && Array.isArray(impact.affected_files)
    && isStringArray(impact.affected_case_ids)
    && isStringArray(impact.evidence_refs)
    && impact.evidence_refs.length > 0
    && isStringArray(impact.blockers);
}

function traceabilityCasesForPath(entries, file, indexes, state) {
  const mapped = new Set();
  for (const entry of entries) {
    if (
      !isRecord(entry)
      || entry.changed_file !== file
    ) {
      continue;
    }
    if (entry.case_ids !== undefined) {
      for (const caseId of validateCaseReferences(
        entry.case_ids,
        `codegraph:${file}`,
        indexes.byId,
        state.blockers
      )) {
        mapped.add(caseId);
      }
    }
    if (isStringArray(entry.requirement_refs)) {
      for (const requirementId of entry.requirement_refs) {
        for (const caseId of indexes.byRequirement.get(requirementId) || []) {
          mapped.add(caseId);
        }
      }
    }
    if (isStringArray(entry.acceptance_refs)) {
      for (const acceptanceId of entry.acceptance_refs) {
        for (const caseId of indexes.byAcceptance.get(acceptanceId) || []) {
          mapped.add(caseId);
        }
      }
    }
  }
  return mapped;
}

function applyCodegraph(
  impact,
  expectedChangeId,
  traceabilityEntries,
  indexes,
  state
) {
  if (impact === null || impact === undefined) return;
  if (!codegraphShapeValid(impact, expectedChangeId)) {
    state.blockers.push(blocker(
      'verification-rerun:codegraph-impact-invalid',
      'codegraph-impact',
      null
    ));
    return;
  }
  state.codegraphRefs.push(...impact.evidence_refs);
  for (const impactBlocker of impact.blockers) {
    state.blockers.push(blocker(
      'verification-rerun:codegraph-impact-blocked',
      'codegraph-impact',
      impactBlocker
    ));
  }

  for (const caseId of validateCaseReferences(
    impact.affected_case_ids,
    'codegraph-impact',
    indexes.byId,
    state.blockers
  )) {
    state.impacted.add(caseId);
    addReason(state.reasons, caseId, 'codegraph:affected-case');
  }

  for (const entry of impact.affected_files) {
    if (
      !isRecord(entry)
      || !isIdentity(entry.path)
      || !isStringArray(entry.evidence_refs)
      || entry.evidence_refs.length === 0
      || (
        entry.case_ids !== undefined
        && !isStringArray(entry.case_ids)
      )
      || entry.evidence_refs.some((reference) => (
        !impact.source_evidence_ids.includes(reference)
      ))
    ) {
      state.blockers.push(blocker(
        'verification-rerun:codegraph-impact-invalid',
        'codegraph-impact',
        'affected_files'
      ));
      continue;
    }
    const mapped = traceabilityCasesForPath(
      traceabilityEntries,
      entry.path,
      indexes,
      state
    );
    if (entry.case_ids !== undefined) {
      for (const caseId of validateCaseReferences(
        entry.case_ids,
        `codegraph:${entry.path}`,
        indexes.byId,
        state.blockers
      )) {
        mapped.add(caseId);
      }
    }
    const caseIds = sorted(mapped);
    if (caseIds.length === 0) {
      state.blockers.push(blocker(
        'verification-rerun:codegraph-case-map-missing',
        'codegraph-impact',
        entry.path
      ));
      continue;
    }
    if (
      state.changedFileSet.has(entry.path)
      && caseIds.length > 0
    ) {
      state.coveredFiles.add(entry.path);
    }
    for (const caseId of caseIds) {
      state.impacted.add(caseId);
      addReason(
        state.reasons,
        caseId,
        `codegraph:changed-file:${entry.path}`
      );
      for (const evidenceRef of entry.evidence_refs) {
        addReason(
          state.reasons,
          caseId,
          `codegraph:evidence:${evidenceRef}`
        );
      }
    }
  }
}

function applyFreshness(freshnessFacts, indexes, state) {
  if (!isRecord(freshnessFacts) || !Array.isArray(freshnessFacts.cases)) {
    state.blockers.push(blocker(
      'verification-rerun:freshness-invalid',
      'case-freshness',
      null
    ));
    return;
  }

  const factsByCase = new Map();
  for (const fact of freshnessFacts.cases) {
    if (
      !isRecord(fact)
      || !isIdentity(fact.case_id)
      || !['fresh', 'stale', 'unknown'].includes(fact.status)
      || !Array.isArray(fact.reasons)
      || fact.reasons.some((reason) => !isIdentity(reason))
      || factsByCase.has(fact.case_id)
    ) {
      state.blockers.push(blocker(
        'verification-rerun:freshness-invalid',
        'case-freshness',
        fact?.case_id || null
      ));
      continue;
    }
    if (!indexes.byId.has(fact.case_id)) {
      state.blockers.push(blocker(
        'verification-rerun:unknown-case-reference',
        'case-freshness',
        fact.case_id
      ));
      continue;
    }
    factsByCase.set(fact.case_id, fact);
  }

  for (const caseId of indexes.byId.keys()) {
    const fact = factsByCase.get(caseId);
    if (!fact) {
      state.blockers.push(blocker(
        'verification-rerun:freshness-fact-missing',
        caseId,
        null
      ));
      state.stale.add(caseId);
      addReason(state.reasons, caseId, 'freshness:fact-missing');
      continue;
    }
    if (fact.status === 'fresh') continue;

    state.stale.add(caseId);
    if (fact.reasons.length === 0) {
      addReason(state.reasons, caseId, `freshness:${fact.status}`);
    } else {
      for (const reason of fact.reasons) {
        addReason(state.reasons, caseId, `freshness:${reason}`);
      }
    }
    if (fact.status === 'unknown') {
      state.blockers.push(blocker(
        'verification-rerun:freshness-unknown',
        caseId,
        fact.reasons.join(',') || null
      ));
    }
  }
}

function createCaseRerunPlanner(options = {}) {
  const { caseApprovalValidator } = options;
  if (
    !caseApprovalValidator
    || typeof caseApprovalValidator.evaluate !== 'function'
  ) {
    throw new Error('verification-rerun:missing-case-approval-validator');
  }

  function plan(request) {
    let input;
    try {
      input = structuredClone(request);
    } catch {
      return unreadableResult('request-unreadable');
    }
    if (!isRecord(input)) return unreadableResult('request-invalid');

    const catalog = catalogState(input.caseCatalog);
    if (!catalog.ok) {
      return deepFreeze({
        ...unreadableResult(catalog.blocker),
        blockers: [
          blocker(
            'verification-rerun:case-catalog-invalid',
            'case-catalog',
            catalog.blocker
          )
        ]
      });
    }
    let approvalResult;
    try {
      approvalResult = caseApprovalValidator.evaluate({
        snapshot: input.caseCatalog,
        approval: input.caseApproval,
        currentRequirements: input.currentRequirements,
        currentAcceptance: input.currentAcceptance,
        expectedReviewerId: input.expectedReviewerId
      });
    } catch {
      return blockedCatalogResult(catalog.cases, [
        blocker(
          'verification-rerun:approval-validation-failed',
          'case-approval',
          null
        )
      ]);
    }
    if (
      !isRecord(approvalResult)
      || approvalResult.ok !== true
      || approvalResult.status !== 'approved-current'
      || !Array.isArray(approvalResult.blockers)
      || approvalResult.blockers.length > 0
    ) {
      return blockedCatalogResult(
        catalog.cases,
        isRecord(approvalResult) ? approvalResult.blockers : null
      );
    }
    if (
      !isStringArray(input.changedFiles)
      || !Array.isArray(input.traceabilityEntries)
      || !isStringArray(input.repairedCaseIds)
      || !isStringArray(input.mandatoryBaselineCaseIds)
      || (
        input.policyRefs !== undefined
        && !isStringArray(input.policyRefs)
      )
    ) {
      return blockedCatalogResult(catalog.cases, [
        blocker(
          'verification-rerun:request-contract-invalid',
          'rerun-scope',
          null
        )
      ]);
    }

    const indexes = caseIndexes(catalog.cases);
    const state = {
      blockers: [],
      reasons: new Map(),
      repaired: new Set(),
      baseline: new Set(),
      impacted: new Set(),
      stale: new Set(),
      coveredFiles: new Set(),
      changedFileSet: new Set(input.changedFiles),
      domains: new Set(),
      codegraphRefs: [],
      policyRefs: input.policyRefs || []
    };

    for (const caseId of validateCaseReferences(
      input.repairedCaseIds,
      'repaired-cases',
      indexes.byId,
      state.blockers
    )) {
      state.repaired.add(caseId);
      addReason(state.reasons, caseId, 'repaired-case');
    }
    for (const caseId of validateCaseReferences(
      input.mandatoryBaselineCaseIds,
      'rerun-policy',
      indexes.byId,
      state.blockers
    )) {
      state.baseline.add(caseId);
      addReason(state.reasons, caseId, 'policy-baseline');
    }

    applyTraceability(input, indexes, state);
    applyCodegraph(
      input.codegraphImpact,
      input.caseCatalog.change_id,
      input.traceabilityEntries,
      indexes,
      state
    );
    applyFreshness(input.freshnessFacts, indexes, state);

    const changedFiles = sorted(input.changedFiles);
    const unmappedChanges = changedFiles.filter((file) => (
      !state.coveredFiles.has(file)
    ));
    for (const file of unmappedChanges) {
      for (const caseId of indexes.byId.keys()) {
        addReason(state.reasons, caseId, `unmapped-change:${file}`);
      }
    }

    const failClosed = state.blockers.length > 0;
    if (failClosed) {
      const blockerReasons = sorted(state.blockers.map((entry) => (
        `fail-closed:${entry.id}`
      )));
      for (const caseId of indexes.byId.keys()) {
        for (const reason of blockerReasons) {
          addReason(state.reasons, caseId, reason);
        }
      }
    }

    const fullRerun = failClosed || unmappedChanges.length > 0;
    if (fullRerun) {
      for (const testCase of catalog.cases) {
        if (!state.reasons.has(testCase.id)) {
          addReason(state.reasons, testCase.id, 'full-rerun');
        }
      }
    }

    const requiredCases = sorted(state.reasons.keys());
    for (const caseId of requiredCases) {
      addCaseDomains(indexes.byId.get(caseId), state.domains);
    }
    if (fullRerun) {
      for (const domain of ALL_DOMAINS) state.domains.add(domain);
    }

    const reasonsByCase = {};
    for (const caseId of requiredCases) {
      reasonsByCase[caseId] = sorted(state.reasons.get(caseId));
    }

    return deepFreeze({
      ok: state.blockers.length === 0,
      full_rerun: fullRerun,
      required_cases: requiredCases,
      baseline_cases: sorted(state.baseline),
      repaired_cases: sorted(state.repaired),
      impacted_cases: sorted(state.impacted),
      stale_cases: sorted(state.stale),
      cases_to_rerun: requiredCases.map((caseId) => ({
        case_id: caseId,
        reasons: reasonsByCase[caseId]
      })),
      reasons_by_case: reasonsByCase,
      changed_files: changedFiles,
      unmapped_changes: unmappedChanges,
      domains_to_rerun: ALL_DOMAINS.filter((domain) => (
        state.domains.has(domain)
      )),
      codegraph_refs: sorted(state.codegraphRefs),
      policy_refs: sorted(state.policyRefs),
      warnings: unmappedChanges.length > 0
        ? [`unmapped-changes:${unmappedChanges.join(',')}`]
        : [],
      blockers: state.blockers
    });
  }

  return Object.freeze({ plan });
}

module.exports = {
  ALL_DOMAINS,
  createCaseRerunPlanner
};
