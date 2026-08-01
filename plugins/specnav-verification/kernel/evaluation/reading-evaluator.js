'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');
const {
  createOracleRegistry
} = require('./oracle-registry');

const DOMAINS = Object.freeze([
  'e2e',
  'facticity',
  'redteam',
  'sensory',
  'static',
  'unit'
]);

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function stableBlockers(values) {
  const unique = new Map();
  for (const value of values) {
    const key = canonicalJson(value);
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ));
}

function invalidResult(detail) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    readings: [],
    blockers: [blocker(
      'verification-reading:request-invalid',
      'reading-request',
      detail
    )]
  });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readingId(reading) {
  return `reading-${sha256(canonicalJson({
    change_id: reading.change_id,
    run_id: reading.run_id,
    case_id: reading.case_id,
    attempt_id: reading.attempt_id,
    step_id: reading.step_id,
    assertion_id: reading.assertion_id,
    domain: reading.domain
  }))}`;
}

function identityValid(testCase, run, attempt) {
  return testCase.id === attempt.case_id
    && testCase.change_id === run.change_id
    && testCase.runner?.kind === attempt.runner
    && attempt.change_id === run.change_id
    && attempt.run_id === run.id
    && run.case_ids.includes(testCase.id)
    && attempt.case_snapshot_hash === run.case_snapshot_hash
    && attempt.code_sha === run.code_sha
    && attempt.test_sha === run.test_sha
    && attempt.environment_hash === run.environment_hash
    && attempt.runtime_version === run.runtime_version
    && attempt.kernel_version === run.kernel_version;
}

function terminalStatusBlockers(input, oracleResults) {
  if (
    oracleResults.size === 0
    || [...oracleResults.values()].some(
      (oracle) => !oracle.ok || !['pass', 'fail'].includes(oracle.verdict)
    )
  ) {
    return [];
  }
  const expected = [...oracleResults.values()].some(
    (oracle) => oracle.verdict === 'fail'
  )
    ? 'failed'
    : 'passed';
  const statuses = [
    ['attempt', input.attempt.status],
    ['execution', input.execution.status]
  ];
  if (
    expected === 'failed'
    || input.run.case_ids.length === 1
    || !['passed', 'failed'].includes(input.run.status)
  ) {
    statuses.unshift(['run', input.run.status]);
  }
  return statuses
    .filter(([, actual]) => actual !== expected)
    .map(([owner, actual]) => blocker(
      'verification-reading:terminal-status-mismatch',
      input.testCase.id,
      { owner, expected, actual }
    ));
}

function stepForAssertion(testCase, assertionId) {
  const matches = testCase.steps.filter(
    (step) => Array.isArray(step.assertion_ids)
      && step.assertion_ids.includes(assertionId)
  );
  return matches.length === 1 ? matches[0] : null;
}

function integrityLookup(integrity) {
  const values = integrity?.facts?.evidence;
  if (!Array.isArray(values)) return new Map();
  return new Map(values.map((entry) => [entry?.evidence_id, entry]));
}

function evidenceForAssertion(input) {
  const {
    testCase,
    run,
    attempt,
    assertion,
    step,
    evidence,
    integrity
  } = input;
  const allowedKinds = new Set(assertion.evidence_kinds);
  const selected = evidence.filter((entry) => (
    entry?.change_id === run.change_id
    && entry?.run_id === run.id
    && entry?.case_id === testCase.id
    && entry?.attempt_id === attempt.id
    && entry?.step_id === step.id
    && entry?.assertion_id === assertion.id
    && entry?.code_sha === run.code_sha
    && entry?.test_sha === run.test_sha
    && allowedKinds.has(entry?.kind)
  ));
  const presentKinds = new Set(selected.map((entry) => entry.kind));
  const blockers = [];
  for (const kind of allowedKinds) {
    if (!presentKinds.has(kind)) {
      blockers.push(blocker(
        'verification-reading:evidence-kind-missing',
        assertion.id,
        kind
      ));
    }
  }
  if (selected.length === 0) {
    blockers.push(blocker(
      'verification-reading:evidence-missing',
      assertion.id
    ));
  }

  const facts = integrityLookup(integrity);
  for (const entry of selected) {
    const fact = facts.get(entry.id);
    if (!fact) {
      blockers.push(blocker(
        'verification-reading:evidence-integrity-missing',
        entry.id
      ));
      continue;
    }
    if (
      fact.integrity !== 'intact'
      || fact.freshness !== 'fresh'
      || fact.binding_match !== true
      || fact.exists !== true
      || fact.hash_match !== true
      || fact.size_match !== true
      || fact.producer_recognized !== true
      || fact.store_record_match !== true
      || fact.path_safe !== true
    ) {
      blockers.push(blocker(
        'verification-reading:evidence-integrity-blocked',
        entry.id,
        {
          integrity: fact.integrity,
          freshness: fact.freshness,
          binding_match: fact.binding_match
        }
      ));
    }
  }
  return {
    evidenceIds: selected.map((entry) => entry.id).sort(),
    blockers: stableBlockers(blockers)
  };
}

function createReadingEvaluator(options = {}) {
  const {
    schemaRegistry,
    oracleRegistry = createOracleRegistry(),
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !oracleRegistry
    || typeof oracleRegistry.evaluate !== 'function'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-reading:config-invalid');
  }

  function evaluate(request) {
    let input;
    try {
      input = structuredClone(request);
    } catch {
      return invalidResult('request-unreadable');
    }
    if (
      !isRecord(input)
      || !isRecord(input.testCase)
      || !isRecord(input.run)
      || !isRecord(input.attempt)
      || !isRecord(input.execution)
      || !Array.isArray(input.evidence)
      || !isRecord(input.integrity)
      || !Array.isArray(input.run.case_ids)
      || !Array.isArray(input.testCase.assertions)
      || !Array.isArray(input.testCase.steps)
      || !isRecord(input.testCase.domains)
    ) {
      return invalidResult('request-shape-invalid');
    }
    if (!identityValid(input.testCase, input.run, input.attempt)) {
      return invalidResult('execution-identity-mismatch');
    }
    const recordedAt = clock();
    if (
      typeof recordedAt !== 'string'
      || Number.isNaN(Date.parse(recordedAt))
    ) {
      return invalidResult('clock-invalid');
    }

    const assertionLookup = new Map(
      input.testCase.assertions.map((entry) => [entry.id, entry])
    );
    if (
      assertionLookup.size !== input.testCase.assertions.length
      || assertionLookup.has(undefined)
    ) {
      return invalidResult('assertion-contract-invalid');
    }

    const readings = [];
    const allBlockers = [];
    const oracleResults = new Map();
    for (const domain of DOMAINS) {
      const assignment = input.testCase.domains[domain];
      if (!isRecord(assignment) || !Array.isArray(assignment.assertion_ids)) {
        return invalidResult(`domain-assignment-invalid:${domain}`);
      }
      if (assignment.mode !== 'required') continue;
      if (assignment.runner !== input.attempt.runner) {
        return invalidResult(`domain-runner-mismatch:${domain}`);
      }
      for (const assertionId of assignment.assertion_ids) {
        const assertion = assertionLookup.get(assertionId);
        const step = assertion
          ? stepForAssertion(input.testCase, assertionId)
          : null;
        if (!assertion || !step) {
          return invalidResult(`assertion-binding-invalid:${assertionId}`);
        }
        const oracle = oracleRegistry.evaluate({
          contract: assertion,
          execution: input.execution,
          attempt: input.attempt
        });
        oracleResults.set(assertion.id, oracle);
        const evidence = evidenceForAssertion({
          ...input,
          assertion,
          step
        });
        const readingBlockers = stableBlockers([
          ...oracle.blockers,
          ...evidence.blockers
        ]);
        const reading = {
          schema: 'specnav.verification.reading.v1',
          id: '',
          change_id: input.run.change_id,
          run_id: input.run.id,
          case_id: input.testCase.id,
          attempt_id: input.attempt.id,
          step_id: step.id,
          assertion_id: assertion.id,
          domain,
          expected: oracle.expected,
          actual: oracle.actual,
          oracle: oracle.oracle,
          evidence_ids: evidence.evidenceIds,
          verdict: readingBlockers.length > 0
            ? 'blocked'
            : oracle.verdict,
          recorded_at: recordedAt,
          code_sha: input.run.code_sha,
          test_sha: input.run.test_sha
        };
        reading.id = readingId(reading);
        const validation = schemaRegistry.validate('reading', reading);
        if (!validation.ok) {
          allBlockers.push(blocker(
            'verification-reading:schema-invalid',
            reading.id,
            validation.blockers
          ));
          continue;
        }
        readings.push(reading);
        allBlockers.push(...readingBlockers);
      }
    }
    if (readings.length === 0) {
      const blockers = stableBlockers(allBlockers);
      if (blockers.length > 0) {
        return deepFreeze({
          ok: false,
          status: 'blocked',
          readings: [],
          blockers
        });
      }
      return invalidResult('required-readings-empty');
    }
    const terminalBlockers = terminalStatusBlockers(input, oracleResults);
    if (terminalBlockers.length > 0) {
      for (const reading of readings) reading.verdict = 'blocked';
    }
    const blockers = stableBlockers([
      ...allBlockers,
      ...terminalBlockers
    ]);
    const status = readings.some((entry) => entry.verdict === 'blocked')
      || blockers.length > 0
      ? 'blocked'
      : readings.some((entry) => entry.verdict === 'fail')
        ? 'fail'
        : 'pass';
    return deepFreeze({
      ok: status !== 'blocked',
      status,
      readings: readings.sort((left, right) => (
        left.domain.localeCompare(right.domain)
        || left.assertion_id.localeCompare(right.assertion_id)
      )),
      blockers
    });
  }

  return Object.freeze({ evaluate });
}

module.exports = {
  DOMAINS,
  createReadingEvaluator
};
