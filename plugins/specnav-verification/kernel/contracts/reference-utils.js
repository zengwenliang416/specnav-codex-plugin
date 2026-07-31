'use strict';

const CROSS_REFERENCE_BLOCKER_ID =
  'verification-contract:cross-reference-invalid';

function entityId(entity, fallback) {
  return entity && typeof entity.id === 'string' && entity.id.length > 0
    ? entity.id
    : fallback;
}

function makeBlocker(options) {
  const blocker = {
    id: options.id || CROSS_REFERENCE_BLOCKER_ID,
    entity_type: options.entityType,
    entity_id: options.entityId,
    field: options.field
  };
  for (const field of [
    'expected',
    'actual',
    'related_entity_type',
    'related_entity_id',
    'detail'
  ]) {
    if (options[field] !== undefined) blocker[field] = options[field];
  }
  return blocker;
}

function compareBlockers(left, right) {
  return (
    String(left.entity_type).localeCompare(String(right.entity_type))
    || String(left.entity_id).localeCompare(String(right.entity_id))
    || String(left.field).localeCompare(String(right.field))
    || String(left.id).localeCompare(String(right.id))
    || JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
}

function stableValueKey(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableValueKey).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number:NaN';
    if (value === Infinity) return 'number:Infinity';
    if (value === -Infinity) return 'number:-Infinity';
    if (Object.is(value, -0)) return 'number:-0';
  }
  const serialized = JSON.stringify(value);
  return `${typeof value}:${serialized === undefined ? String(value) : serialized}`;
}

function blockerKey(blocker) {
  return stableValueKey(blocker);
}

function createBlockerCollector() {
  const blockers = [];
  const keys = new Set();

  function add(blocker) {
    const key = blockerKey(blocker);
    if (keys.has(key)) return;
    keys.add(key);
    blockers.push(blocker);
  }

  function addMismatch(options) {
    if (options.actual === options.expected) return;
    add(makeBlocker({
      entityType: options.entityType,
      entityId: options.entityId,
      field: `/${options.field}`,
      expected: options.expected,
      actual: options.actual,
      related_entity_type: options.relatedEntityType,
      related_entity_id: options.relatedEntityId
    }));
  }

  return Object.freeze({
    add,
    addMismatch,
    result() {
      if (blockers.length === 0) {
        return { ok: true, blockers: [] };
      }
      return {
        ok: false,
        blockers: [...blockers].sort(compareBlockers)
      };
    }
  });
}

function createEntityLookup(items, entityType, collector) {
  const lookup = new Map();
  for (const item of items) {
    if (!lookup.has(item.id)) {
      lookup.set(item.id, item);
      continue;
    }
    collector.add(makeBlocker({
      entityType,
      entityId: entityId(item, '<duplicate>'),
      field: '/id',
      expected: 'unique entity id',
      actual: item.id,
      detail: 'duplicate entity id'
    }));
  }
  return lookup;
}

function graphShapeBlocker(field, expected, actual, activeChangeId) {
  return makeBlocker({
    entityType: 'verification-graph',
    entityId: typeof activeChangeId === 'string' && activeChangeId.length > 0
      ? activeChangeId
      : 'verification-graph',
    field,
    expected,
    actual
  });
}

module.exports = {
  CROSS_REFERENCE_BLOCKER_ID,
  createBlockerCollector,
  createEntityLookup,
  entityId,
  graphShapeBlocker,
  makeBlocker
};
