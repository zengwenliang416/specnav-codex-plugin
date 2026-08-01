'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURES = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures/positive'
);
const kernel = require(path.join(ROOT, 'plugins/specnav-verification'));
const {
  createReadingEvaluator
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/evaluation'
));
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const DOMAINS = [
  'e2e',
  'facticity',
  'redteam',
  'sensory',
  'static',
  'unit'
];

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function evidence(overrides = {}) {
  return {
    schema: 'specnav.verification.evidence.v1',
    id: 'evidence-minimal',
    kind: 'structured_comparison',
    path: `objects/${'a'.repeat(64)}.json`,
    sha256: 'a'.repeat(64),
    size: 42,
    producer: 'command-runner',
    captured_at: '2026-07-31T00:00:01Z',
    change_id: 'change-v2',
    run_id: 'run-minimal',
    case_id: 'case-minimal',
    attempt_id: 'attempt-minimal',
    step_id: 'step-1',
    assertion_id: 'assertion-1',
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(40),
    environment_hash: 'd'.repeat(64),
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    ...overrides
  };
}

function integrity(evidenceRecord, overrides = {}) {
  return {
    ok: true,
    facts: {
      summary: {
        evidence_count: 1,
        integrity: 'intact',
        freshness: 'fresh'
      },
      evidence: [{
        evidence_id: evidenceRecord.id,
        integrity: 'intact',
        freshness: 'fresh',
        exists: true,
        hash_match: true,
        size_match: true,
        producer_recognized: true,
        store_record_match: true,
        binding_match: true,
        path_safe: true
      }]
    },
    blockers: [],
    ...overrides
  };
}

function baseRequest(overrides = {}) {
  const testCase = fixture('test-case.json');
  const run = fixture('verification-run.json');
  const attempt = fixture('attempt.json');
  const evidenceRecord = evidence();
  return {
    testCase,
    run: {
      ...run,
      status: 'passed',
      started_at: '2026-07-31T00:00:00Z',
      completed_at: '2026-07-31T00:00:01Z'
    },
    attempt,
    execution: {
      status: 'passed',
      assertions: [{
        id: 'assertion-1',
        method: 'equal',
        expected: true,
        actual: true,
        status: 'passed'
      }],
      oracle: {
        type: 'deterministic',
        producer: 'command-runner',
        facts: [{
          assertion_id: 'assertion-1',
          expected: true,
          actual: true,
          status: 'passed'
        }]
      },
      blockers: []
    },
    evidence: [evidenceRecord],
    integrity: integrity(evidenceRecord),
    ...overrides
  };
}

function setRunner(request, runner) {
  request.testCase.runner.kind = runner;
  request.testCase.runner.requires_midscene = runner === 'midscene';
  request.attempt.runner = runner;
  for (const assignment of Object.values(request.testCase.domains)) {
    if (assignment.mode === 'required') assignment.runner = runner;
  }
}

function addSecondAssertion(request, overrides = {}) {
  request.testCase.steps.push({
    id: 'step-2',
    action: 'Validate a second fact',
    expected: 'The second fact is evaluated',
    assertion_ids: ['assertion-2']
  });
  request.testCase.assertions.push({
    id: 'assertion-2',
    statement: 'The second fact matches',
    expected: true,
    oracle: {
      type: 'structured_comparison',
      human_signoff_allowed: false
    },
    evidence_kinds: ['structured_comparison']
  });
  for (const assignment of Object.values(request.testCase.domains)) {
    if (assignment.mode === 'required') {
      assignment.assertion_ids.push('assertion-2');
    }
  }
  request.execution.assertions.push({
    id: 'assertion-2',
    method: 'equal',
    expected: true,
    actual: overrides.actual ?? false,
    status: overrides.status || 'failed'
  });
  request.execution.oracle.facts.push({
    assertion_id: 'assertion-2',
    expected: true,
    actual: overrides.actual ?? false,
    status: overrides.status || 'failed'
  });
  const evidenceRecord = evidence({
    id: 'evidence-second',
    step_id: 'step-2',
    assertion_id: 'assertion-2',
    path: `objects/${'b'.repeat(64)}.json`,
    sha256: 'b'.repeat(64)
  });
  request.evidence.push(evidenceRecord);
  request.integrity.facts.summary.evidence_count = 2;
  request.integrity.facts.evidence.push(
    integrity(evidenceRecord).facts.evidence[0]
  );
}

function evaluator() {
  assert.equal(typeof createReadingEvaluator, 'function');
  assert.equal(typeof kernel.createReadingEvaluator, 'function');
  return createReadingEvaluator({
    schemaRegistry: readySchemaRegistry(),
    clock: () => '2026-08-01T02:20:00Z'
  });
}

test('deterministic assertion creates one evidence-bound reading per required domain', () => {
  const request = baseRequest();
  const before = structuredClone(request);
  const result = evaluator().evaluate(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.readings.map((reading) => reading.domain), DOMAINS);
  assert.equal(new Set(result.readings.map((reading) => reading.id)).size, 6);
  for (const reading of result.readings) {
    assert.equal(reading.schema, 'specnav.verification.reading.v1');
    assert.equal(reading.step_id, 'step-1');
    assert.equal(reading.assertion_id, 'assertion-1');
    assert.equal(reading.expected, true);
    assert.equal(reading.actual, true);
    assert.deepEqual(reading.oracle, {
      type: 'structured_comparison',
      owner: 'command-runner',
      deterministic: true
    });
    assert.deepEqual(reading.evidence_ids, ['evidence-minimal']);
    assert.equal(reading.verdict, 'pass');
    assert.equal(reading.recorded_at, '2026-08-01T02:20:00Z');
  }
  assert.deepEqual(request, before);
});

test('failed deterministic assertion remains a valid failed reading set', () => {
  const request = baseRequest();
  request.execution.status = 'failed';
  request.execution.assertions[0].actual = false;
  request.execution.assertions[0].status = 'failed';
  request.execution.oracle.facts[0].actual = false;
  request.execution.oracle.facts[0].status = 'failed';
  request.run.status = 'failed';
  request.attempt.status = 'failed';
  request.attempt.exit_status = 1;

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'fail');
  assert.equal(result.readings.length, 6);
  assert.equal(result.readings.every((reading) => (
    reading.actual === false && reading.verdict === 'fail'
  )), true);
});

test('mixed assertion results preserve pass and fail readings under a failed case', () => {
  const request = baseRequest();
  addSecondAssertion(request);
  request.run.status = 'failed';
  request.attempt.status = 'failed';
  request.attempt.exit_status = 1;
  request.execution.status = 'failed';

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'fail');
  assert.equal(result.readings.length, 12);
  assert.equal(
    result.readings.filter((reading) => reading.verdict === 'pass').length,
    6
  );
  assert.equal(
    result.readings.filter((reading) => reading.verdict === 'fail').length,
    6
  );
});

test('a passing case may belong to a failed multi-case run', () => {
  const request = baseRequest();
  request.run.case_ids.push('case-failed-elsewhere');
  request.run.status = 'failed';

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'pass');
  assert.equal(
    result.readings.every((reading) => reading.verdict === 'pass'),
    true
  );
});

test('Midscene observation without an authoritative oracle stays blocked', () => {
  const request = baseRequest();
  setRunner(request, 'midscene');
  request.execution.assertions = [];
  request.execution.oracle = {
    type: 'midscene_observation',
    producer: 'midscene-runner',
    observation: 'The model says the UI looks correct.'
  };

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.readings.length, 6);
  assert.equal(result.readings.every((reading) => (
    reading.verdict === 'blocked'
    && reading.oracle.type === 'midscene_observation'
    && reading.oracle.deterministic === false
  )), true);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-reading:authoritative-oracle-missing'
    )),
    true
  );
});

test('missing, stale, or broken evidence blocks an otherwise passing reading', () => {
  for (const defect of ['missing', 'stale', 'broken']) {
    const request = baseRequest();
    if (defect === 'missing') {
      request.evidence = [];
      request.integrity = {
        ok: false,
        facts: {
          summary: {
            evidence_count: 0,
            integrity: 'broken',
            freshness: 'unknown'
          },
          evidence: []
        },
        blockers: [{
          id: 'verification-integrity:evidence-empty',
          artifact: 'verification-graph',
          detail: null
        }]
      };
    } else {
      request.integrity.ok = false;
      request.integrity.facts.summary[
        defect === 'stale' ? 'freshness' : 'integrity'
      ] = defect === 'stale' ? 'stale' : 'broken';
      request.integrity.facts.evidence[0][
        defect === 'stale' ? 'freshness' : 'integrity'
      ] = defect === 'stale' ? 'stale' : 'broken';
      request.integrity.blockers = [{
        id: defect === 'stale'
          ? 'verification-integrity:evidence-stale'
          : 'verification-integrity:evidence-hash-mismatch',
        artifact: 'evidence-minimal',
        detail: null
      }];
    }

    const result = evaluator().evaluate(request);

    assert.equal(result.ok, false, defect);
    assert.equal(result.status, 'blocked', defect);
    assert.equal(
      result.readings.every((reading) => reading.verdict === 'blocked'),
      true,
      defect
    );
  }
});

test('approved human signoff becomes an inspectable non-deterministic oracle', () => {
  const request = baseRequest();
  request.testCase.assertions[0].oracle = {
    type: 'human_signoff',
    human_signoff_allowed: true
  };
  setRunner(request, 'midscene');
  request.execution.assertions = [];
  request.execution.oracle = {
    type: 'human_signoff',
    producer: 'approved-human-reviewer',
    signoff: {
      decision: 'approved',
      reason: 'Reviewed retained screenshot and trace.',
      decided_at: '2026-08-01T02:19:00Z',
      reviewer: {
        id: 'reviewer-1',
        kind: 'human',
        display_name: 'Verification reviewer'
      },
      assertion_ids: ['assertion-1'],
      change_id: 'change-v2',
      run_id: 'run-minimal',
      case_id: 'case-minimal',
      attempt_id: 'attempt-minimal'
    }
  };
  request.evidence[0].kind = 'human_signoff';
  request.testCase.assertions[0].evidence_kinds = ['human_signoff'];

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'pass');
  assert.equal(result.readings.every((reading) => (
    reading.oracle.type === 'human_signoff'
    && reading.oracle.owner === 'reviewer-1'
    && reading.oracle.deterministic === false
    && reading.actual.decision === 'approved'
    && reading.verdict === 'pass'
  )), true);
});

test('forged assertion status and malformed requests fail closed', () => {
  const forged = baseRequest();
  forged.execution.assertions[0].actual = false;
  forged.execution.assertions[0].status = 'passed';
  forged.execution.oracle.facts[0].actual = false;

  const forgedResult = evaluator().evaluate(forged);
  assert.equal(forgedResult.ok, false);
  assert.equal(forgedResult.status, 'blocked');
  assert.equal(
    forgedResult.blockers.some((entry) => (
      entry.id === 'verification-reading:oracle-result-forged'
    )),
    true
  );

  const malformed = evaluator().evaluate({ testCase: null });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.status, 'blocked');
  assert.equal(malformed.readings.length, 0);
  assert.equal(
    malformed.blockers[0].id,
    'verification-reading:request-invalid'
  );
});

test('runner and terminal identity mismatches cannot create a passing reading', () => {
  const terminalMismatch = baseRequest();
  terminalMismatch.execution.status = 'failed';
  const terminalResult = evaluator().evaluate(terminalMismatch);

  assert.equal(terminalResult.ok, false);
  assert.equal(terminalResult.status, 'blocked');
  assert.equal(
    terminalResult.blockers.some((entry) => (
      entry.id === 'verification-reading:terminal-status-mismatch'
    )),
    true
  );

  const runnerMismatch = baseRequest();
  runnerMismatch.attempt.runner = 'playwright';
  const runnerResult = evaluator().evaluate(runnerMismatch);

  assert.equal(runnerResult.ok, false);
  assert.equal(runnerResult.status, 'blocked');
  assert.equal(
    runnerResult.blockers[0].detail,
    'execution-identity-mismatch'
  );
});

test('run-owned attempt fingerprints must match before reading creation', () => {
  const mismatches = {
    case_snapshot_hash: '9'.repeat(64),
    environment_hash: '8'.repeat(64),
    runtime_version: '1.0.1',
    kernel_version: '2.0.1'
  };

  for (const [field, value] of Object.entries(mismatches)) {
    const request = baseRequest();
    request.attempt[field] = value;
    const result = evaluator().evaluate(request);

    assert.equal(result.ok, false, field);
    assert.equal(result.status, 'blocked', field);
    assert.equal(result.readings.length, 0, field);
    assert.equal(
      result.blockers[0].detail,
      'execution-identity-mismatch',
      field
    );
  }
});

test('reading schema failures preserve their exact blocker and artifact', () => {
  const request = baseRequest();
  setRunner(request, 'midscene');
  request.execution.oracle.producer = 'invalid owner';

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.readings.length, 0);
  assert.equal(
    result.blockers.every((entry) => (
      entry.id === 'verification-reading:schema-invalid'
      && entry.artifact.startsWith('reading-')
    )),
    true,
    JSON.stringify(result.blockers)
  );
});
