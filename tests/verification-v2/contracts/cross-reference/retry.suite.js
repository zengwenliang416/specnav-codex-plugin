'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertRetryBlocker,
  graphWithRetry,
  retryPair,
  validateGraph,
  validateRetry
} = require('./test-helpers');

function registerRetrySemanticsSuite() {
  test(
    'retry validation distinguishes parent and retry semantics',
    async (t) => {
      await t.test('accepts a retry with the same fingerprint', () => {
        const { parentAttempt, retryAttempt } = retryPair();
        assert.deepEqual(validateRetry(parentAttempt, retryAttempt), {
          ok: true,
          blockers: []
        });
      });

      await t.test('requires parent_attempt_id', () => {
        const { parentAttempt, retryAttempt } = retryPair();
        delete retryAttempt.parent_attempt_id;
        const result = validateRetry(parentAttempt, retryAttempt);
        assertRetryBlocker(
          result,
          'verification-contract:retry-parent-required',
          'parent_attempt_id'
        );
      });

      await t.test('requires the parent to exist in the supplied graph', () => {
        const graph = graphWithRetry();
        graph.attempts[1].parent_attempt_id = 'missing-parent';
        const result = validateGraph(graph);
        assertRetryBlocker(
          result,
          'verification-contract:retry-parent-not-found',
          'parent_attempt_id'
        );
      });

      await t.test(
        'requires sequence to equal parent sequence plus one',
        () => {
          const { parentAttempt, retryAttempt } = retryPair();
          retryAttempt.sequence = parentAttempt.sequence + 2;
          const result = validateRetry(parentAttempt, retryAttempt);
          assertRetryBlocker(
            result,
            'verification-contract:retry-sequence-invalid',
            'sequence'
          );
        }
      );

      await t.test('rejects a parent from a different run', () => {
        const { parentAttempt, retryAttempt } = retryPair();
        parentAttempt.run_id = 'different-run';
        const result = validateRetry(parentAttempt, retryAttempt);
        assertRetryBlocker(
          result,
          'verification-contract:retry-fingerprint-mismatch',
          'run_id'
        );
      });

      await t.test('rejects a parent from a different case', () => {
        const { parentAttempt, retryAttempt } = retryPair();
        parentAttempt.case_id = 'different-case';
        const result = validateRetry(parentAttempt, retryAttempt);
        assertRetryBlocker(
          result,
          'verification-contract:retry-fingerprint-mismatch',
          'case_id'
        );
      });

      await t.test(
        'requires retry kind and never misclassifies retest or regression',
        () => {
          const { parentAttempt, retryAttempt } = retryPair();
          retryAttempt.kind = 'retest';
          const result = validateRetry(parentAttempt, retryAttempt);
          assertRetryBlocker(
            result,
            'verification-contract:retry-kind-required',
            'kind'
          );
        }
      );
    }
  );
}

function registerRetryFingerprintSuite() {
  test('retry rejects every changed immutable fingerprint', async (t) => {
    const changedFingerprints = [
      ['run_id', 'different-run'],
      ['change_id', 'different-change'],
      ['case_id', 'different-case'],
      ['case_snapshot_hash', '1'.repeat(64)],
      ['runner', 'playwright'],
      ['code_sha', '3'.repeat(40)],
      ['test_sha', '4'.repeat(40)],
      ['scenario_hash', '5'.repeat(64)],
      ['environment_hash', '6'.repeat(64)],
      ['browser_project', 'chromium'],
      ['test_data_snapshot', '7'.repeat(64)],
      ['runtime_version', '9.9.9'],
      ['kernel_version', '8.8.8']
    ];

    for (const [field, value] of changedFingerprints) {
      await t.test(field, () => {
        const { parentAttempt, retryAttempt } = retryPair();
        retryAttempt[field] = value;
        const result = validateRetry(parentAttempt, retryAttempt);
        assertRetryBlocker(
          result,
          'verification-contract:retry-fingerprint-mismatch',
          field
        );
      });
    }
  });
}

function registerRetrySuite() {
  registerRetrySemanticsSuite();
  registerRetryFingerprintSuite();
}

module.exports = registerRetrySuite;
