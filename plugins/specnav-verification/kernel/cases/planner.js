'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const { sortedStrings } = require('./normalize');
const {
  blocker,
  validateCases,
  validateCoverage,
  validateSources
} = require('./case-validation');

function createCasePlanner(options = {}) {
  const { schemaRegistry } = options;
  if (!schemaRegistry || typeof schemaRegistry.validate !== 'function') {
    throw new Error('verification-cases:missing-schema-registry');
  }

  function plan(input = {}) {
    const blockers = [];
    const changeId = input.changeId;
    if (typeof changeId !== 'string' || !changeId.trim()) {
      blockers.push(blocker('verification-cases:change-id-missing', '/changeId'));
    }
    const requirements = validateSources(
      input.requirements,
      'requirements',
      blockers
    );
    const acceptance = validateSources(
      input.acceptance,
      'acceptance',
      blockers
    );
    if (!Array.isArray(input.cases) || input.cases.length === 0) {
      blockers.push(blocker('verification-cases:no-cases', '/cases'));
    }
    const cases = validateCases({
      rawCases: input.cases,
      changeId,
      sources: {
        requirements: requirements.ids,
        acceptance: acceptance.ids
      },
      schemaRegistry,
      blockers
    });
    const coverage = validateCoverage(cases, {
      requirements: requirements.ids,
      acceptance: acceptance.ids
    }, blockers);

    return deepFreeze({
      ok: blockers.length === 0,
      change_id: changeId || null,
      requirements: requirements.normalized,
      acceptance: acceptance.normalized,
      cases: [...cases].sort((left, right) => left.id.localeCompare(right.id)),
      coverage: {
        requirement_ids: sortedStrings([...coverage.requirements]),
        acceptance_ids: sortedStrings([...coverage.acceptance])
      },
      blockers
    });
  }

  return Object.freeze({ plan });
}

module.exports = {
  createCasePlanner
};
