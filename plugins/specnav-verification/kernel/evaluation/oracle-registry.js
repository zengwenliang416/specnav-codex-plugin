'use strict';

const { isDeepStrictEqual } = require('node:util');

const DETERMINISTIC_ORACLES = new Set([
  'playwright_assertion',
  'api_fact',
  'database_fact',
  'structured_comparison'
]);

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function blocked(assertionId, id, options = {}) {
  return {
    ok: false,
    expected: options.expected,
    actual: options.actual ?? null,
    oracle: options.oracle || {
      type: 'none',
      owner: 'verification-kernel',
      deterministic: false
    },
    verdict: 'blocked',
    blockers: [blocker(id, assertionId, options.detail || null)]
  };
}

function assertionResults(execution, assertionId) {
  if (!Array.isArray(execution.assertions)) return [];
  return execution.assertions.filter((entry) => entry?.id === assertionId);
}

function recomputeAssertion(result) {
  if (result.method === 'equal') {
    return isDeepStrictEqual(result.actual, result.expected);
  }
  if (result.method === 'ok') {
    return result.expected === true && result.actual === true;
  }
  return isDeepStrictEqual(result.actual, result.expected);
}

function deterministicOwner(attempt, execution) {
  if (attempt.runner === 'midscene') {
    return typeof execution.oracle?.producer === 'string'
      ? execution.oracle.producer
      : 'specnav-playwright-worker';
  }
  if (attempt.runner === 'playwright') return 'playwright-runner';
  return 'command-runner';
}

function matchingOracleFact(execution, assertionId) {
  if (!Array.isArray(execution.oracle?.facts)) return null;
  const matches = execution.oracle.facts.filter(
    (entry) => entry?.assertion_id === assertionId
  );
  return matches.length === 1 ? matches[0] : null;
}

function evaluateDeterministic(contract, execution, attempt) {
  const results = assertionResults(execution, contract.id);
  const observation = execution.oracle?.type === 'midscene_observation'
    ? execution.oracle.observation ?? null
    : null;
  if (results.length === 0) {
    return blocked(
      contract.id,
      'verification-reading:authoritative-oracle-missing',
      {
        expected: structuredClone(contract.expected),
        actual: structuredClone(observation),
        oracle: observation === null
          ? undefined
          : {
              type: 'midscene_observation',
              owner: 'midscene-runner',
              deterministic: false
            }
      }
    );
  }
  if (results.length !== 1) {
    return blocked(
      contract.id,
      'verification-reading:oracle-result-ambiguous',
      { expected: structuredClone(contract.expected) }
    );
  }
  const result = results[0];
  if (
    !result
    || typeof result !== 'object'
    || !Object.prototype.hasOwnProperty.call(result, 'expected')
    || !Object.prototype.hasOwnProperty.call(result, 'actual')
    || !['passed', 'failed'].includes(result.status)
    || !isDeepStrictEqual(result.expected, contract.expected)
  ) {
    return blocked(
      contract.id,
      'verification-reading:oracle-result-invalid',
      { expected: structuredClone(contract.expected) }
    );
  }
  const passed = recomputeAssertion(result);
  if ((passed ? 'passed' : 'failed') !== result.status) {
    return blocked(
      contract.id,
      'verification-reading:oracle-result-forged',
      {
        expected: structuredClone(contract.expected),
        actual: structuredClone(result.actual)
      }
    );
  }
  if (attempt.runner === 'midscene') {
    const fact = matchingOracleFact(execution, contract.id);
    if (
      execution.oracle?.type !== 'deterministic'
      || !fact
      || !isDeepStrictEqual(fact.expected, result.expected)
      || !isDeepStrictEqual(fact.actual, result.actual)
      || fact.status !== result.status
    ) {
      return blocked(
        contract.id,
        'verification-reading:authoritative-oracle-missing',
        {
          expected: structuredClone(contract.expected),
          actual: structuredClone(result.actual),
          oracle: {
            type: 'midscene_observation',
            owner: 'midscene-runner',
            deterministic: false
          }
        }
      );
    }
  }
  return {
    ok: true,
    expected: structuredClone(contract.expected),
    actual: structuredClone(result.actual),
    oracle: {
      type: contract.oracle.type,
      owner: deterministicOwner(attempt, execution),
      deterministic: true
    },
    verdict: passed ? 'pass' : 'fail',
    blockers: []
  };
}

function validHumanSignoff(signoff, identity, assertionId) {
  return signoff
    && typeof signoff === 'object'
    && !Array.isArray(signoff)
    && signoff.decision === 'approved'
    && typeof signoff.reason === 'string'
    && signoff.reason.trim() !== ''
    && !Number.isNaN(Date.parse(signoff.decided_at))
    && signoff.reviewer?.kind === 'human'
    && typeof signoff.reviewer.id === 'string'
    && signoff.reviewer.id.length > 0
    && Array.isArray(signoff.assertion_ids)
    && signoff.assertion_ids.includes(assertionId)
    && signoff.change_id === identity.change_id
    && signoff.run_id === identity.run_id
    && signoff.case_id === identity.case_id
    && signoff.attempt_id === identity.attempt_id;
}

function evaluateHuman(contract, execution, attempt) {
  const signoff = execution.oracle?.signoff;
  const identity = {
    change_id: attempt.change_id,
    run_id: attempt.run_id,
    case_id: attempt.case_id,
    attempt_id: attempt.id
  };
  if (
    contract.oracle.human_signoff_allowed !== true
    || execution.oracle?.type !== 'human_signoff'
    || !validHumanSignoff(signoff, identity, contract.id)
  ) {
    return blocked(
      contract.id,
      'verification-reading:human-signoff-invalid',
      { expected: structuredClone(contract.expected) }
    );
  }
  return {
    ok: true,
    expected: structuredClone(contract.expected),
    actual: {
      decision: signoff.decision,
      reason: signoff.reason,
      reviewer_id: signoff.reviewer.id,
      decided_at: signoff.decided_at
    },
    oracle: {
      type: 'human_signoff',
      owner: signoff.reviewer.id,
      deterministic: false
    },
    verdict: 'pass',
    blockers: []
  };
}

function createOracleRegistry() {
  function evaluate(request) {
    const { contract, execution, attempt } = request || {};
    if (
      !contract
      || typeof contract !== 'object'
      || !execution
      || typeof execution !== 'object'
      || !attempt
      || typeof attempt !== 'object'
    ) {
      return blocked(
        'oracle',
        'verification-reading:oracle-request-invalid'
      );
    }
    if (contract.oracle?.type === 'human_signoff') {
      return evaluateHuman(contract, execution, attempt);
    }
    if (!DETERMINISTIC_ORACLES.has(contract.oracle?.type)) {
      return blocked(
        contract.id || 'oracle',
        'verification-reading:oracle-type-unsupported',
        { expected: structuredClone(contract.expected) }
      );
    }
    return evaluateDeterministic(contract, execution, attempt);
  }

  return Object.freeze({ evaluate });
}

module.exports = {
  DETERMINISTIC_ORACLES,
  createOracleRegistry
};
