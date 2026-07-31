'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertCrossReferenceBlocker,
  changedGraph,
  fixtureGraph,
  readySchemaRegistry,
  validateGraph
} = require('./test-helpers');

function registerFailClosedSuite() {
  test(
    'graph shape, duplicate ids, and unknown references fail closed',
    async (t) => {
      for (const field of ['attempts', 'readings', 'evidence']) {
        await t.test(`${field} must be an array`, () => {
          const graph = fixtureGraph();
          graph[field] = {};
          const result = validateGraph(graph);
          assertCrossReferenceBlocker(
            result,
            'verification-graph',
            'change-v2',
            field
          );
        });
      }

      const duplicateEntities = [
        ['case', 'test-case', (graph) => graph.caseSnapshot.cases],
        ['attempt', 'attempt', (graph) => graph.attempts],
        ['reading', 'reading', (graph) => graph.readings],
        ['evidence', 'evidence', (graph) => graph.evidence]
      ];

      for (const [name, entityType, select] of duplicateEntities) {
        await t.test(
          `${name} duplicate id is rejected deterministically`,
          () => {
            const graph = fixtureGraph();
            const entities = select(graph);
            entities.push(structuredClone(entities[0]));

            const first = validateGraph(graph);
            const second = validateGraph(graph);

            assert.deepEqual(first, second);
            assertCrossReferenceBlocker(
              first,
              entityType,
              entities[0].id,
              'id'
            );
          }
        );
      }

      await t.test(
        'unknown attempt kind returns only exact schema blockers',
        () => {
          const registry = readySchemaRegistry();
          const graph = fixtureGraph();
          graph.attempts[0].kind = 'unknown-kind';
          const expected = registry.validate('attempt', graph.attempts[0]);

          const result = validateGraph(graph, registry);

          assert.equal(expected.ok, false);
          assert.deepEqual(result.blockers, expected.blockers);
          assert.equal(
            result.blockers.some((blocker) => (
              blocker.id === 'verification-contract:cross-reference-invalid'
            )),
            false
          );
        }
      );

      await t.test(
        'non-retry attempt rejects an unknown parent reference',
        () => {
          const result = validateGraph(changedGraph((graph) => {
            graph.attempts[0].parent_attempt_id = 'missing-parent';
          }));
          assertCrossReferenceBlocker(
            result,
            'attempt',
            'attempt-minimal',
            'parent_attempt_id'
          );
        }
      );
    }
  );
}

module.exports = registerFailClosedSuite;
