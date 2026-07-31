'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertCrossReferenceBlocker,
  changedGraph,
  fixtureGraph,
  validateGraph
} = require('./test-helpers');

function registerPrimaryIdentitySuite() {
  test(
    'binds active change, snapshot, run, case, and attempt identities',
    async (t) => {
      const activeChangeMutations = [
        ['case-snapshot', 'snapshot-minimal', (graph) => {
          graph.caseSnapshot.change_id = 'different-change';
        }],
        ['test-case', 'case-minimal', (graph) => {
          graph.caseSnapshot.cases[0].change_id = 'different-change';
        }],
        ['verification-run', 'run-minimal', (graph) => {
          graph.run.change_id = 'different-change';
        }],
        ['attempt', 'attempt-minimal', (graph) => {
          graph.attempts[0].change_id = 'different-change';
        }],
        ['reading', 'reading-minimal', (graph) => {
          graph.readings[0].change_id = 'different-change';
        }],
        ['evidence', 'evidence-minimal', (graph) => {
          graph.evidence[0].change_id = 'different-change';
        }]
      ];

      for (const [entityType, entityId, mutate] of activeChangeMutations) {
        await t.test(
          `${entityType}.change_id matches activeChangeId`,
          () => {
            const result = validateGraph(changedGraph(mutate));
            assertCrossReferenceBlocker(
              result,
              entityType,
              entityId,
              'change_id'
            );
          }
        );
      }

      const runBindings = [
        ['case_snapshot_id', (graph) => {
          graph.run.case_snapshot_id = 'different-snapshot';
        }],
        ['case_snapshot_hash', (graph) => {
          graph.run.case_snapshot_hash = '1'.repeat(64);
        }]
      ];

      for (const [field, mutate] of runBindings) {
        await t.test(`run.${field} matches the supplied snapshot`, () => {
          const result = validateGraph(changedGraph(mutate));
          assertCrossReferenceBlocker(
            result,
            'verification-run',
            'run-minimal',
            field
          );
        });
      }

      await t.test('attempt case exists in the case snapshot', () => {
        const result = validateGraph(changedGraph((graph) => {
          graph.caseSnapshot.cases[0].id = 'different-case';
        }));
        assertCrossReferenceBlocker(
          result,
          'attempt',
          'attempt-minimal',
          'case_id'
        );
      });

      await t.test('attempt case exists in run.case_ids', () => {
        const result = validateGraph(changedGraph((graph) => {
          graph.run.case_ids = ['different-case'];
        }));
        assertCrossReferenceBlocker(
          result,
          'attempt',
          'attempt-minimal',
          'case_id'
        );
      });

      const attemptBindings = [
        ['run_id', 'different-run'],
        ['case_snapshot_hash', '2'.repeat(64)],
        ['change_id', 'different-change'],
        ['case_id', 'different-case'],
        ['code_sha', '3'.repeat(40)],
        ['test_sha', '4'.repeat(40)],
        ['environment_hash', '5'.repeat(64)],
        ['runtime_version', '9.9.9'],
        ['kernel_version', '8.8.8'],
        ['runner', 'playwright']
      ];

      for (const [field, value] of attemptBindings) {
        await t.test(
          `attempt.${field} matches run, snapshot, or case`,
          () => {
            const result = validateGraph(changedGraph((graph) => {
              graph.attempts[0][field] = value;
            }));
            assertCrossReferenceBlocker(
              result,
              'attempt',
              'attempt-minimal',
              field
            );
          }
        );
      }
    }
  );
}

function registerCaseInternalSuite() {
  test(
    'case internals and browser execution identity are cross-referenced',
    async (t) => {
      function addSecondAssertion(graph) {
        const assertion = structuredClone(
          graph.caseSnapshot.cases[0].assertions[0]
        );
        assertion.id = 'assertion-2';
        assertion.statement = 'A second shape-valid assertion';
        graph.caseSnapshot.cases[0].assertions.push(assertion);
      }

      await t.test('browser attempt matches case runner browser_project', () => {
        const result = validateGraph(changedGraph((graph) => {
          const testCase = graph.caseSnapshot.cases[0];
          testCase.runner.kind = 'playwright';
          testCase.runner.scenario_id = 'scenario-main';
          testCase.runner.scenario_hash = 'e'.repeat(64);
          testCase.runner.browser_project = 'chromium';
          testCase.runner.allowed_origins = ['https://example.invalid'];
          graph.attempts[0].runner = 'playwright';
          graph.attempts[0].browser_project = 'webkit';
        }));
        assertCrossReferenceBlocker(
          result,
          'attempt',
          'attempt-minimal',
          'browser_project'
        );
      });

      await t.test(
        'command runner uses deterministic none browser project',
        () => {
          const graph = fixtureGraph();
          assert.equal(graph.caseSnapshot.cases[0].runner.kind, 'command');
          assert.equal(graph.attempts[0].browser_project, 'none');
          assert.deepEqual(validateGraph(graph), {
            ok: true,
            blockers: []
          });
        }
      );

      await t.test(
        'duplicate case step ids are rejected deterministically',
        () => {
          const graph = fixtureGraph();
          const steps = graph.caseSnapshot.cases[0].steps;
          steps.push(structuredClone(steps[0]));

          const first = validateGraph(graph);
          const second = validateGraph(graph);

          assert.deepEqual(first, second);
          assertCrossReferenceBlocker(
            first,
            'test-case',
            'case-minimal',
            'steps'
          );
        }
      );

      await t.test(
        'duplicate case assertion ids are rejected deterministically',
        () => {
          const graph = fixtureGraph();
          const assertions = graph.caseSnapshot.cases[0].assertions;
          assertions.push(structuredClone(assertions[0]));

          const first = validateGraph(graph);
          const second = validateGraph(graph);

          assert.deepEqual(first, second);
          assertCrossReferenceBlocker(
            first,
            'test-case',
            'case-minimal',
            'assertions'
          );
        }
      );

      await t.test('step assertion_ids resolve to case assertions', () => {
        const result = validateGraph(changedGraph((graph) => {
          graph.caseSnapshot.cases[0].steps[0].assertion_ids = [
            'missing-assertion'
          ];
        }));
        assertCrossReferenceBlocker(
          result,
          'test-case',
          'case-minimal',
          'steps/0/assertion_ids'
        );
      });

      for (const domain of [
        'facticity',
        'static',
        'unit',
        'redteam',
        'e2e',
        'sensory'
      ]) {
        await t.test(
          `${domain} assertion_ids resolve to case assertions`,
          () => {
            const result = validateGraph(changedGraph((graph) => {
              graph.caseSnapshot.cases[0].domains[domain].assertion_ids = [
                'missing-assertion'
              ];
            }));
            assertCrossReferenceBlocker(
              result,
              'test-case',
              'case-minimal',
              `domains/${domain}/assertion_ids`
            );
          }
        );
      }

      await t.test(
        'reading assertion_id belongs to its selected step',
        () => {
          const result = validateGraph(changedGraph((graph) => {
            addSecondAssertion(graph);
            graph.readings[0].assertion_id = 'assertion-2';
            graph.evidence[0].assertion_id = 'assertion-2';
          }));
          assertCrossReferenceBlocker(
            result,
            'reading',
            'reading-minimal',
            'assertion_id'
          );
        }
      );

      await t.test(
        'evidence assertion_id belongs to its selected step',
        () => {
          const result = validateGraph(changedGraph((graph) => {
            addSecondAssertion(graph);
            graph.readings[0].assertion_id = 'assertion-2';
            graph.evidence[0].assertion_id = 'assertion-2';
          }));
          assertCrossReferenceBlocker(
            result,
            'evidence',
            'evidence-minimal',
            'assertion_id'
          );
        }
      );

      await t.test('matching step and assertion ids pass together', () => {
        const graph = fixtureGraph();
        graph.readings[0].assertion_id = 'assertion-1';
        graph.evidence[0].assertion_id = 'assertion-1';
        assert.deepEqual(validateGraph(graph), {
          ok: true,
          blockers: []
        });
      });
    }
  );
}

function registerIdentityBindingsSuite() {
  registerPrimaryIdentitySuite();
  registerCaseInternalSuite();
}

module.exports = registerIdentityBindingsSuite;
