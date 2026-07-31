'use strict';

const { normalizeCase, normalizeSourceList } = require('./normalize');

function blocker(id, field, options = {}) {
  const value = {
    id,
    artifact: 'case-plan',
    field
  };
  if (options.caseId !== undefined) value.case_id = options.caseId;
  if (options.relatedId !== undefined) value.related_id = options.relatedId;
  if (options.detail !== undefined) value.detail = options.detail;
  return value;
}

function validateSources(values, kind, blockers) {
  if (!Array.isArray(values) || values.length === 0) {
    blockers.push(blocker(`verification-cases:${kind}-missing`, `/${kind}`));
    return { normalized: [], ids: new Set() };
  }
  const normalized = normalizeSourceList(values, kind);
  const ids = new Set();
  normalized.forEach((entry, index) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) {
      blockers.push(blocker(
        `verification-cases:${kind}-id-invalid`,
        `/${kind}/${index}/id`
      ));
      return;
    }
    if (ids.has(entry.id)) {
      blockers.push(blocker(
        `verification-cases:${kind}-duplicate`,
        `/${kind}/${index}/id`,
        { relatedId: entry.id }
      ));
      return;
    }
    ids.add(entry.id);
  });
  return { normalized, ids };
}

function duplicateIds(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates].sort();
}

function validateUniqueMembers(testCase, index, blockers) {
  for (const [members, id] of [
    [testCase.steps, 'verification-cases:duplicate-step'],
    [testCase.assertions, 'verification-cases:duplicate-assertion']
  ]) {
    for (const duplicate of duplicateIds(members)) {
      blockers.push(blocker(id, `/cases/${index}`, {
        caseId: testCase.id,
        relatedId: duplicate
      }));
    }
  }
}

function validateAssertionReferences(testCase, index, blockers) {
  const assertionIds = new Set(testCase.assertions.map((entry) => entry.id));
  const stepReferences = new Set();
  const domainReferences = new Set();
  const assignments = [
    ...testCase.steps.map((step, stepIndex) => ({
      ids: step.assertion_ids,
      known: stepReferences,
      blockerId: 'verification-cases:unknown-step-assertion',
      field: `/cases/${index}/steps/${stepIndex}/assertion_ids`
    })),
    ...Object.entries(testCase.domains).map(([domain, assignment]) => ({
      ids: assignment.assertion_ids,
      known: domainReferences,
      blockerId: 'verification-cases:unknown-domain-assertion',
      field: `/cases/${index}/domains/${domain}/assertion_ids`
    }))
  ];
  for (const assignment of assignments) {
    for (const assertionId of assignment.ids) {
      assignment.known.add(assertionId);
      if (!assertionIds.has(assertionId)) {
        blockers.push(blocker(assignment.blockerId, assignment.field, {
          caseId: testCase.id,
          relatedId: assertionId
        }));
      }
    }
  }
  for (const assertionId of assertionIds) {
    if (!stepReferences.has(assertionId)) {
      blockers.push(blocker(
        'verification-cases:assertion-without-step',
        `/cases/${index}/assertions`,
        { caseId: testCase.id, relatedId: assertionId }
      ));
    }
    if (!domainReferences.has(assertionId)) {
      blockers.push(blocker(
        'verification-cases:assertion-without-domain',
        `/cases/${index}/assertions`,
        { caseId: testCase.id, relatedId: assertionId }
      ));
    }
  }
}

function validateEvidencePolicy(testCase, index, blockers) {
  const allowed = new Set(testCase.evidence_policy.allowed_kinds);
  for (const evidenceKind of testCase.evidence_policy.required_kinds) {
    if (!allowed.has(evidenceKind)) {
      blockers.push(blocker(
        'verification-cases:required-evidence-not-allowed',
        `/cases/${index}/evidence_policy/required_kinds`,
        { caseId: testCase.id, relatedId: evidenceKind }
      ));
    }
  }
  testCase.assertions.forEach((assertion, assertionIndex) => {
    for (const evidenceKind of assertion.evidence_kinds) {
      if (!allowed.has(evidenceKind)) {
        blockers.push(blocker(
          'verification-cases:assertion-evidence-not-allowed',
          `/cases/${index}/assertions/${assertionIndex}/evidence_kinds`,
          { caseId: testCase.id, relatedId: evidenceKind }
        ));
      }
    }
  });
}

function validateCaseReferences(testCase, index, sources, blockers) {
  for (const [ids, known, id, field] of [
    [
      testCase.requirement_ids,
      sources.requirements,
      'verification-cases:unknown-requirement',
      'requirement_ids'
    ],
    [
      testCase.acceptance_ids,
      sources.acceptance,
      'verification-cases:unknown-acceptance',
      'acceptance_ids'
    ]
  ]) {
    for (const relatedId of ids) {
      if (!known.has(relatedId)) {
        blockers.push(blocker(id, `/cases/${index}/${field}`, {
          caseId: testCase.id,
          relatedId
        }));
      }
    }
  }
}

function validateCaseRecord(options) {
  const {
    rawCase,
    index,
    changeId,
    caseIds,
    sources,
    schemaRegistry,
    blockers
  } = options;
  const validation = schemaRegistry.validate('test-case', rawCase, {
    artifactPath: `memory://case-plan/cases/${index}`
  });
  if (!validation.ok) {
    blockers.push(...validation.blockers);
    return null;
  }
  const testCase = normalizeCase(validation.value);
  if (caseIds.has(testCase.id)) {
    blockers.push(blocker(
      'verification-cases:duplicate-case',
      `/cases/${index}/id`,
      { caseId: testCase.id }
    ));
  }
  caseIds.add(testCase.id);
  if (testCase.change_id !== changeId) {
    blockers.push(blocker(
      'verification-cases:case-change-mismatch',
      `/cases/${index}/change_id`,
      { caseId: testCase.id, detail: `${testCase.change_id} != ${changeId}` }
    ));
  }
  if (testCase.status !== 'ready') {
    blockers.push(blocker(
      'verification-cases:case-not-ready',
      `/cases/${index}/status`,
      { caseId: testCase.id, detail: testCase.status }
    ));
  }
  validateUniqueMembers(testCase, index, blockers);
  validateAssertionReferences(testCase, index, blockers);
  validateEvidencePolicy(testCase, index, blockers);
  validateCaseReferences(testCase, index, sources, blockers);
  return testCase;
}

function validateCases(options) {
  const rawCases = Array.isArray(options.rawCases) ? options.rawCases : [];
  const caseIds = new Set();
  return rawCases
    .map((rawCase, index) => validateCaseRecord({
      ...options,
      rawCase,
      index,
      caseIds
    }))
    .filter(Boolean);
}

function validateCoverage(cases, sourceIds, blockers) {
  const coverage = {
    requirements: new Set(cases.flatMap((entry) => entry.requirement_ids)),
    acceptance: new Set(cases.flatMap((entry) => entry.acceptance_ids))
  };
  for (const kind of ['requirements', 'acceptance']) {
    for (const relatedId of sourceIds[kind]) {
      if (!coverage[kind].has(relatedId)) {
        blockers.push(blocker(
          `verification-cases:${kind === 'requirements' ? 'requirement' : 'acceptance'}-uncovered`,
          '/cases',
          { relatedId }
        ));
      }
    }
  }
  return coverage;
}

module.exports = {
  blocker,
  validateCases,
  validateCoverage,
  validateSources
};
