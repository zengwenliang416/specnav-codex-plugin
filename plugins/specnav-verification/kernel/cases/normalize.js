'use strict';

const { deepFreeze } = require('../contracts/schema-registry');

const DOMAIN_NAMES = Object.freeze([
  'facticity',
  'static',
  'unit',
  'redteam',
  'e2e',
  'sensory'
]);

function sortedStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeCase(value) {
  const normalized = structuredClone(value);
  for (const field of ['requirement_ids', 'acceptance_ids', 'preconditions']) {
    if (Array.isArray(normalized[field])) {
      normalized[field] = sortedStrings(normalized[field]);
    }
  }
  if (Array.isArray(normalized.assertions)) {
    normalized.assertions = normalized.assertions.map((assertion) => ({
      ...assertion,
      evidence_kinds: Array.isArray(assertion.evidence_kinds)
        ? sortedStrings(assertion.evidence_kinds)
        : assertion.evidence_kinds
    }));
  }
  if (normalized.domains && typeof normalized.domains === 'object') {
    const domains = {};
    for (const domain of DOMAIN_NAMES) {
      const assignment = normalized.domains[domain];
      domains[domain] = assignment && typeof assignment === 'object'
        ? {
            ...assignment,
            assertion_ids: Array.isArray(assignment.assertion_ids)
              ? sortedStrings(assignment.assertion_ids)
              : assignment.assertion_ids
          }
        : assignment;
    }
    normalized.domains = domains;
  }
  if (normalized.evidence_policy && typeof normalized.evidence_policy === 'object') {
    normalized.evidence_policy = {
      ...normalized.evidence_policy,
      allowed_kinds: Array.isArray(normalized.evidence_policy.allowed_kinds)
        ? sortedStrings(normalized.evidence_policy.allowed_kinds)
        : normalized.evidence_policy.allowed_kinds,
      required_kinds: Array.isArray(normalized.evidence_policy.required_kinds)
        ? sortedStrings(normalized.evidence_policy.required_kinds)
        : normalized.evidence_policy.required_kinds
    };
  }
  return deepFreeze(normalized);
}

function normalizeSourceList(values, kind) {
  if (!Array.isArray(values)) return null;
  return deepFreeze(values
    .map((value) => (
      typeof value === 'string'
        ? { id: value }
        : structuredClone(value)
    ))
    .sort((left, right) => (
      String(left?.id).localeCompare(String(right?.id))
    )));
}

module.exports = {
  DOMAIN_NAMES,
  normalizeCase,
  normalizeSourceList,
  sortedStrings
};
