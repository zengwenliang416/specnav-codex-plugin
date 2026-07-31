'use strict';

const test = require('node:test');
const {
  assertCrossReferenceBlocker,
  assertReadingEvidenceBlocker,
  changedGraph,
  validateGraph
} = require('./test-helpers');

function registerReadingSuite() {
  test(
    'reading references resolve through run, case, attempt, and evidence',
    async (t) => {
      const readingBindings = [
        ['run_id', 'different-run'],
        ['case_id', 'different-case'],
        ['attempt_id', 'different-attempt'],
        ['step_id', 'different-step'],
        ['code_sha', '3'.repeat(40)],
        ['test_sha', '4'.repeat(40)]
      ];

      for (const [field, value] of readingBindings) {
        await t.test(`reading.${field}`, () => {
          const result = validateGraph(changedGraph((graph) => {
            graph.readings[0][field] = value;
          }));
          assertCrossReferenceBlocker(
            result,
            'reading',
            'reading-minimal',
            field
          );
        });
      }

      await t.test('reading.assertion_id belongs to the case', () => {
        const result = validateGraph(changedGraph((graph) => {
          delete graph.readings[1].step_id;
          graph.readings[1].assertion_id = 'different-assertion';
        }));
        assertCrossReferenceBlocker(
          result,
          'reading',
          'reading-assertion',
          'assertion_id'
        );
      });

      await t.test(
        'reading.evidence_ids resolve to supplied evidence',
        () => {
          const result = validateGraph(changedGraph((graph) => {
            graph.readings[0].evidence_ids = ['missing-evidence'];
          }));
          assertCrossReferenceBlocker(
            result,
            'reading',
            'reading-minimal',
            'evidence_ids'
          );
        }
      );

      await t.test(
        'assertion reading rejects evidence captured for a step',
        () => {
          const result = validateGraph(changedGraph((graph) => {
            graph.readings[1].evidence_ids = ['evidence-minimal'];
          }));
          assertReadingEvidenceBlocker(
            result,
            'reading-assertion',
            'evidence-minimal'
          );
        }
      );

      await t.test(
        'reading rejects shape-valid evidence from another attempt',
        () => {
          const result = validateGraph(changedGraph((graph) => {
            const otherAttempt = structuredClone(graph.attempts[0]);
            otherAttempt.id = 'attempt-other';
            graph.attempts.push(otherAttempt);

            const otherEvidence = structuredClone(graph.evidence[0]);
            otherEvidence.id = 'evidence-other-attempt';
            otherEvidence.attempt_id = otherAttempt.id;
            graph.evidence.push(otherEvidence);

            graph.readings[0].evidence_ids = [otherEvidence.id];
          }));
          assertReadingEvidenceBlocker(
            result,
            'reading-minimal',
            'evidence-other-attempt'
          );
        }
      );
    }
  );
}

function registerEvidenceSuite() {
  test(
    'evidence validates only references and execution identity',
    async (t) => {
      const evidenceBindings = [
        ['run_id', 'different-run'],
        ['case_id', 'different-case'],
        ['attempt_id', 'different-attempt'],
        ['step_id', 'different-step'],
        ['code_sha', '3'.repeat(40)],
        ['test_sha', '4'.repeat(40)],
        ['environment_hash', '5'.repeat(64)],
        ['runtime_version', '9.9.9'],
        ['kernel_version', '8.8.8']
      ];

      for (const [field, value] of evidenceBindings) {
        await t.test(`evidence.${field}`, () => {
          const result = validateGraph(changedGraph((graph) => {
            graph.evidence[0][field] = value;
          }));
          assertCrossReferenceBlocker(
            result,
            'evidence',
            'evidence-minimal',
            field
          );
        });
      }

      await t.test('evidence.assertion_id belongs to the case', () => {
        const result = validateGraph(changedGraph((graph) => {
          delete graph.evidence[1].step_id;
          graph.evidence[1].assertion_id = 'different-assertion';
        }));
        assertCrossReferenceBlocker(
          result,
          'evidence',
          'evidence-assertion',
          'assertion_id'
        );
      });
    }
  );
}

function registerArtifactBindingsSuite() {
  registerReadingSuite();
  registerEvidenceSuite();
}

module.exports = registerArtifactBindingsSuite;
