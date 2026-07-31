'use strict';

const { isDeepStrictEqual } = require('node:util');

const { deepFreeze } = require('../contracts/schema-registry');

const DETERMINISTIC_ORACLES = new Set([
  'playwright_assertion',
  'api_fact',
  'database_fact',
  'structured_comparison'
]);

function oracleBlocker(id, artifact = 'midscene-oracle', detail = null) {
  return { id, artifact, detail };
}

function blocked(id, detail = null) {
  return deepFreeze({
    status: 'blocked',
    oracle: null,
    blockers: [oracleBlocker(id, 'midscene-oracle', detail)]
  });
}

function expectedAssertions(testCase) {
  const configured = testCase.runner.oracle_assertion_ids;
  const assertions = new Map(testCase.assertions.map((entry) => [
    entry.id,
    entry
  ]));
  if (!Array.isArray(configured) || configured.length === 0) return null;
  if (configured.some((id) => !assertions.has(id))) return null;
  return configured.map((id) => assertions.get(id));
}

function resolveMidsceneOracleMode(testCase) {
  const assertions = expectedAssertions(testCase);
  if (!assertions) {
    return {
      mode: null,
      blocker: oracleBlocker(
        'verification-execution:midscene-oracle-contract-invalid'
      )
    };
  }
  if (assertions.every((entry) => entry.oracle.type === 'human_signoff')) {
    return { mode: 'human_signoff', blocker: null };
  }
  if (assertions.every(
    (entry) => DETERMINISTIC_ORACLES.has(entry.oracle.type)
  )) {
    return { mode: 'deterministic', blocker: null };
  }
  return {
    mode: null,
    blocker: oracleBlocker(
      'verification-execution:midscene-oracle-contract-mixed'
    )
  };
}

function sameAssertionIds(expected, actual) {
  if (expected.length !== actual.length) return false;
  const left = [...expected].sort();
  const right = [...actual].sort();
  return left.every((entry, index) => entry === right[index]);
}

function validEvidence(input) {
  return input?.screenshot?.producer === 'midscene-runner'
    && typeof input.screenshot.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(input.screenshot.sha256)
    && Number.isInteger(input.screenshot.size)
    && input.screenshot.size > 0;
}

function evaluateDeterministicOracle(assertions, input) {
  if (
    assertions.some((entry) => !DETERMINISTIC_ORACLES.has(entry.oracle.type))
    || !Array.isArray(input.assertions)
    || !sameAssertionIds(
      assertions.map((entry) => entry.id),
      input.assertions.map((entry) => entry?.id)
    )
    || !validEvidence(input)
  ) {
    return blocked(
      'verification-execution:midscene-oracle-assertion-mismatch'
    );
  }

  const contracts = new Map(assertions.map((entry) => [entry.id, entry]));
  const facts = [];
  for (const result of input.assertions) {
    const contract = contracts.get(result.id);
    if (
      !result
      || typeof result !== 'object'
      || !['equal', 'ok'].includes(result.method)
      || !['passed', 'failed'].includes(result.status)
      || !Object.prototype.hasOwnProperty.call(result, 'expected')
      || !Object.prototype.hasOwnProperty.call(result, 'actual')
      || !isDeepStrictEqual(result.expected, contract.expected)
    ) {
      return blocked(
        'verification-execution:midscene-oracle-result-invalid',
        result?.id || null
      );
    }
    const passed = result.method === 'equal'
      ? isDeepStrictEqual(result.actual, result.expected)
      : !!result.actual === true && result.expected === true;
    if ((passed ? 'passed' : 'failed') !== result.status) {
      return blocked(
        'verification-execution:midscene-oracle-result-forged',
        result.id
      );
    }
    facts.push({
      assertion_id: result.id,
      method: result.method,
      actual: structuredClone(result.actual),
      expected: structuredClone(result.expected),
      status: result.status
    });
  }
  const failed = facts.filter((entry) => entry.status === 'failed');
  return deepFreeze({
    status: failed.length === 0 ? 'passed' : 'failed',
    oracle: {
      type: 'deterministic',
      producer: 'specnav-playwright-worker',
      evidence_sha256: input.screenshot.sha256,
      facts
    },
    blockers: failed.length === 0
      ? []
      : [oracleBlocker(
        'verification-execution:midscene-oracle-failed',
        'midscene-oracle',
        failed.map((entry) => entry.assertion_id).join(',')
      )]
  });
}

function evaluateHumanSignoff(assertions, input, options) {
  if (
    assertions.some((entry) => (
      entry.oracle.type !== 'human_signoff'
      || entry.oracle.human_signoff_allowed !== true
    ))
    || !validEvidence(input)
  ) {
    return blocked(
      'verification-execution:midscene-human-signoff-not-allowed'
    );
  }
  const signoff = input.signoff;
  const identity = input.identity;
  if (
    !signoff
    || typeof signoff !== 'object'
    || Array.isArray(signoff)
    || signoff.decision !== 'approved'
    || typeof signoff.reason !== 'string'
    || signoff.reason.trim() === ''
    || Number.isNaN(Date.parse(signoff.decided_at))
    || signoff.reviewer?.kind !== 'human'
    || typeof signoff.reviewer?.id !== 'string'
    || signoff.reviewer.id.trim() === ''
    || signoff.reviewer.id !== options.expectedReviewerId
    || !sameAssertionIds(
      assertions.map((entry) => entry.id),
      signoff.assertion_ids
    )
    || signoff.change_id !== identity.change_id
    || signoff.run_id !== identity.run_id
    || signoff.case_id !== identity.case_id
    || signoff.attempt_id !== identity.attempt_id
    || signoff.case_snapshot_hash !== identity.case_snapshot_hash
    || signoff.screenshot_sha256 !== input.screenshot.sha256
  ) {
    return blocked(
      'verification-execution:midscene-human-signoff-invalid'
    );
  }
  return deepFreeze({
    status: 'passed',
    oracle: {
      type: 'human_signoff',
      producer: 'approved-human-reviewer',
      evidence_sha256: input.screenshot.sha256,
      signoff: structuredClone(signoff)
    },
    blockers: []
  });
}

function evaluateMidsceneOracle(testCase, input, options = {}) {
  const assertions = expectedAssertions(testCase);
  const mode = resolveMidsceneOracleMode(testCase);
  if (!assertions || mode.blocker || !input || typeof input !== 'object') {
    return blocked(
      mode.blocker?.id
        || 'verification-execution:midscene-oracle-contract-invalid'
    );
  }
  if (mode.mode === 'human_signoff') {
    return evaluateHumanSignoff(assertions, input, options);
  }
  return evaluateDeterministicOracle(assertions, input);
}

module.exports = {
  DETERMINISTIC_ORACLES,
  evaluateMidsceneOracle,
  oracleBlocker,
  resolveMidsceneOracleMode
};
