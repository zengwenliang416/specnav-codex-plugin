'use strict';

const { makeBlocker } = require('./reference-utils');

function addMissingCaseBlocker(entityType, entity, collector) {
  collector.add(makeBlocker({
    entityType,
    entityId: entity.id,
    field: '/case_id',
    expected: 'case present in supplied case snapshot',
    actual: entity.case_id,
    related_entity_type: 'case-snapshot'
  }));
}

function addUnknownMemberBlocker(options) {
  const {
    entityType,
    entity,
    field,
    lookup,
    testCase,
    collector
  } = options;
  const memberId = entity[field];
  if (memberId === undefined || lookup.has(memberId)) return;
  collector.add(makeBlocker({
    entityType,
    entityId: entity.id,
    field: `/${field}`,
    expected: [...lookup.keys()].sort(),
    actual: memberId,
    related_entity_type: 'test-case',
    related_entity_id: testCase.id
  }));
}

function addStepAssertionOwnershipBlocker(
  entityType,
  entity,
  step,
  assertion,
  testCase,
  collector
) {
  if (!step || !assertion || step.assertion_ids.includes(assertion.id)) {
    return;
  }
  collector.add(makeBlocker({
    entityType,
    entityId: entity.id,
    field: '/assertion_id',
    expected: [...step.assertion_ids].sort(),
    actual: assertion.id,
    related_entity_type: 'test-case',
    related_entity_id: testCase.id,
    detail: `assertion does not belong to step ${step.id}`
  }));
}

function addCaseMemberBinding(entityType, entity, testCase, collector) {
  if (!testCase) {
    addMissingCaseBlocker(entityType, entity, collector);
    return;
  }

  const stepLookup = new Map(
    testCase.steps.map((step) => [step.id, step])
  );
  const assertionLookup = new Map(
    testCase.assertions.map((assertion) => [assertion.id, assertion])
  );
  addUnknownMemberBlocker({
    entityType,
    entity,
    field: 'step_id',
    lookup: stepLookup,
    testCase,
    collector
  });
  addUnknownMemberBlocker({
    entityType,
    entity,
    field: 'assertion_id',
    lookup: assertionLookup,
    testCase,
    collector
  });
  addStepAssertionOwnershipBlocker(
    entityType,
    entity,
    stepLookup.get(entity.step_id),
    assertionLookup.get(entity.assertion_id),
    testCase,
    collector
  );
}

module.exports = {
  addCaseMemberBinding
};
