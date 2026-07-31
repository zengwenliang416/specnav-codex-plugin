'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../../..');
const {
  createBlockerCollector,
  makeBlocker
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/contracts/reference-utils'
));

function registerReferenceUtilsSuite() {
  test('blocker dedupe preserves distinct semantic payloads', () => {
    const collector = createBlockerCollector();
    const first = makeBlocker({
      entityType: 'reading',
      entityId: 'reading-minimal',
      field: '/evidence_ids',
      expected: ['evidence-a'],
      actual: ['missing-a'],
      related_entity_type: 'evidence',
      related_entity_id: 'evidence-minimal',
      detail: 'first mismatch'
    });
    const second = makeBlocker({
      entityType: 'reading',
      entityId: 'reading-minimal',
      field: '/evidence_ids',
      expected: ['evidence-b'],
      actual: ['missing-b'],
      related_entity_type: 'evidence',
      related_entity_id: 'evidence-minimal',
      detail: 'second mismatch'
    });

    collector.add(first);
    collector.add(second);
    collector.add(first);

    const result = collector.result();
    assert.equal(result.ok, false);
    assert.equal(result.blockers.length, 2);
    assert.deepEqual(
      result.blockers.map((blocker) => blocker.detail).sort(),
      ['first mismatch', 'second mismatch']
    );
  });
}

module.exports = registerReferenceUtilsSuite;
