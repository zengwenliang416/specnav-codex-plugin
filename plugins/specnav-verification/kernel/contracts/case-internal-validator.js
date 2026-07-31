'use strict';

const { makeBlocker } = require('./reference-utils');

const CASE_DOMAINS = Object.freeze([
  'facticity',
  'static',
  'unit',
  'redteam',
  'e2e',
  'sensory'
]);

function duplicateIds(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates].sort();
}

function unknownIds(ids, lookup) {
  return [...new Set(ids.filter((id) => !lookup.has(id)))].sort();
}

function addDuplicateIdBlocker(
  collector,
  testCase,
  field,
  expected,
  duplicates
) {
  if (duplicates.length === 0) return;
  collector.add(makeBlocker({
    entityType: 'test-case',
    entityId: testCase.id,
    field,
    expected,
    actual: duplicates,
    related_entity_type: 'test-case',
    related_entity_id: testCase.id
  }));
}

function addUnknownAssertionBlocker(
  collector,
  testCase,
  field,
  expectedAssertionIds,
  assertionIds,
  assertionLookup
) {
  const missingAssertionIds = unknownIds(assertionIds, assertionLookup);
  if (missingAssertionIds.length === 0) return;
  collector.add(makeBlocker({
    entityType: 'test-case',
    entityId: testCase.id,
    field,
    expected: expectedAssertionIds,
    actual: missingAssertionIds,
    related_entity_type: 'test-case',
    related_entity_id: testCase.id
  }));
}

function addCaseInternalBindings(graph, collector) {
  for (const testCase of graph.caseSnapshot.cases) {
    addDuplicateIdBlocker(
      collector,
      testCase,
      '/steps',
      'unique step ids',
      duplicateIds(testCase.steps)
    );
    addDuplicateIdBlocker(
      collector,
      testCase,
      '/assertions',
      'unique assertion ids',
      duplicateIds(testCase.assertions)
    );

    const assertionLookup = new Map(
      testCase.assertions.map((assertion) => [assertion.id, assertion])
    );
    const expectedAssertionIds = [...assertionLookup.keys()].sort();

    testCase.steps.forEach((step, index) => {
      addUnknownAssertionBlocker(
        collector,
        testCase,
        `/steps/${index}/assertion_ids`,
        expectedAssertionIds,
        step.assertion_ids,
        assertionLookup
      );
    });

    for (const domain of CASE_DOMAINS) {
      addUnknownAssertionBlocker(
        collector,
        testCase,
        `/domains/${domain}/assertion_ids`,
        expectedAssertionIds,
        testCase.domains[domain].assertion_ids,
        assertionLookup
      );
    }
  }
}

module.exports = {
  addCaseInternalBindings
};
