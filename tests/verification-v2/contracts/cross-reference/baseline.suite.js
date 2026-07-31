'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createValidator,
  fixtureGraph,
  readySchemaRegistry,
  requireFactory,
  validateGraph
} = require('./test-helpers');

function registerBaselineSuite() {
  test('fixture graph is shape-valid before Task 004 validation', () => {
    const registry = readySchemaRegistry();
    const graph = fixtureGraph();
    const entities = [
      ['case-snapshot', graph.caseSnapshot],
      ['verification-run', graph.run],
      ...graph.attempts.map((value) => ['attempt', value]),
      ...graph.readings.map((value) => ['reading', value]),
      ...graph.evidence.map((value) => ['evidence', value])
    ];

    for (const [entityType, value] of entities) {
      const result = registry.validate(entityType, value);
      assert.equal(result.ok, true, JSON.stringify(result.blockers));
    }
  });

  test(
    'factory requires the Task 003 schema registry and exposes one validator API',
    async (t) => {
      await t.test('rejects missing schemaRegistry without fallback', () => {
        const factory = requireFactory();
        assert.throws(
          () => factory({}),
          /verification-contract:schema-registry-required/
        );
      });

      await t.test('returns cross-reference and retry validators', () => {
        createValidator();
      });
    }
  );

  test(
    'accepts the complete graph without approval or evidence integrity checks',
    () => {
      assert.deepEqual(validateGraph(fixtureGraph()), {
        ok: true,
        blockers: []
      });
    }
  );
}

module.exports = registerBaselineSuite;
