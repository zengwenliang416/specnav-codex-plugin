'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  fixtureGraph,
  readySchemaRegistry,
  retryPair,
  validateGraph,
  validateRetry
} = require('./test-helpers');

function registerSchemaFirstSuite() {
  test(
    'schema validation returns exact blockers before cross-reference checks',
    async (t) => {
      const registry = readySchemaRegistry();
      const invalidEntities = [
        ['case-snapshot', (graph) => graph.caseSnapshot, (value) => {
          delete value.schema;
          value.change_id = 'different-change';
        }],
        ['verification-run', (graph) => graph.run, (value) => {
          delete value.schema;
          value.case_snapshot_id = 'different-snapshot';
        }],
        ['attempt', (graph) => graph.attempts[0], (value) => {
          delete value.schema;
          value.run_id = 'different-run';
        }],
        ['reading', (graph) => graph.readings[0], (value) => {
          delete value.schema;
          value.attempt_id = 'different-attempt';
        }],
        ['evidence', (graph) => graph.evidence[0], (value) => {
          delete value.schema;
          value.attempt_id = 'different-attempt';
        }]
      ];

      for (const [entityType, select, mutate] of invalidEntities) {
        await t.test(entityType, () => {
          const graph = fixtureGraph();
          const value = select(graph);
          mutate(value);
          const expected = registry.validate(entityType, value);

          assert.equal(expected.ok, false);
          assert.equal(
            expected.blockers.every((blocker) => (
              blocker.id === 'verification-contract:schema-invalid'
            )),
            true
          );

          const result = validateGraph(graph, registry);
          assert.equal(result.ok, false, JSON.stringify(result));
          assert.deepEqual(result.blockers, expected.blockers);
          assert.equal(
            result.blockers.some((blocker) => (
              blocker.id === 'verification-contract:cross-reference-invalid'
            )),
            false
          );
        });
      }
    }
  );
}

function registerImmutabilitySuite() {
  test(
    'cross-reference and retry validation never mutate caller input',
    async (t) => {
      await t.test('graph input remains unchanged', () => {
        const graph = fixtureGraph();
        const before = structuredClone(graph);
        validateGraph(graph);
        assert.deepEqual(graph, before);
      });

      await t.test('retry inputs remain unchanged', () => {
        const { parentAttempt, retryAttempt } = retryPair();
        const parentBefore = structuredClone(parentAttempt);
        const retryBefore = structuredClone(retryAttempt);
        validateRetry(parentAttempt, retryAttempt);
        assert.deepEqual(parentAttempt, parentBefore);
        assert.deepEqual(retryAttempt, retryBefore);
      });
    }
  );
}

function registerSchemaAndImmutabilitySuite() {
  registerSchemaFirstSuite();
  registerImmutabilitySuite();
}

module.exports = registerSchemaAndImmutabilitySuite;
