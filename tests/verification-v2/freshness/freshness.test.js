'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures/positive'
);
const kernel = require(path.join(ROOT, 'plugins/specnav-verification'));
const {
  evaluateFreshness
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/evidence/freshness'
));

const FIELDS = Object.freeze([
  'case_snapshot_hash',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version',
  'browser_project',
  'test_data_snapshot'
]);

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));
}

function makeRequest() {
  const caseSnapshot = fixture('case-snapshot.json');
  const run = fixture('verification-run.json');
  const attempt = fixture('attempt.json');
  run.status = 'passed';
  run.started_at = '2026-07-31T00:00:00Z';
  run.completed_at = '2026-07-31T00:00:01Z';
  return {
    caseSnapshot,
    run,
    attempts: [attempt],
    currentFingerprints: {
      case_snapshot_hash: run.case_snapshot_hash,
      code_sha: run.code_sha,
      test_sha: run.test_sha,
      environment_hash: run.environment_hash,
      runtime_version: run.runtime_version,
      kernel_version: run.kernel_version,
      cases: {
        [attempt.case_id]: {
          browser_project: attempt.browser_project,
          test_data_snapshot: attempt.test_data_snapshot
        }
      }
    }
  };
}

function evaluator() {
  return kernel.createCaseFreshnessEvaluator({
    clock: () => '2026-07-31T20:50:00Z'
  });
}

test('matching run and case fingerprints produce a fresh case fact', () => {
  const result = evaluator().evaluate(makeRequest());

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    status: 'fresh',
    total: 1,
    fresh: 1,
    stale: 0,
    unknown: 0
  });
  assert.deepEqual(result.cases, [{
    case_id: 'case-minimal',
    attempt_id: 'attempt-minimal',
    checked_at: '2026-07-31T20:50:00Z',
    status: 'fresh',
    reasons: []
  }]);
  assert.deepEqual(result.blockers, []);
});

for (const field of FIELDS) {
  test(`changed ${field} makes the concrete case stale`, () => {
    const request = makeRequest();
    if (field === 'browser_project' || field === 'test_data_snapshot') {
      request.currentFingerprints.cases['case-minimal'][field] = (
        field === 'browser_project' ? 'webkit' : '9'.repeat(64)
      );
    } else {
      request.currentFingerprints[field] = field.endsWith('_hash')
        ? '8'.repeat(64)
        : field.endsWith('_sha')
          ? '7'.repeat(40)
          : '9.9.9';
    }

    const result = evaluator().evaluate(request);

    assert.equal(result.ok, false);
    assert.equal(result.summary.status, 'stale');
    assert.equal(result.cases[0].status, 'stale');
    assert.deepEqual(result.cases[0].reasons, [`${field}:mismatch`]);
    assert.deepEqual(result.blockers, [{
      id: 'verification-freshness:fingerprint-mismatch',
      artifact: 'case-minimal',
      detail: field
    }]);
  });
}

test('missing current case fingerprint is unknown and blocks freshness', () => {
  const request = makeRequest();
  delete request.currentFingerprints.cases['case-minimal'].browser_project;

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.equal(result.cases[0].status, 'unknown');
  assert.deepEqual(result.cases[0].reasons, [
    'browser_project:current-missing'
  ]);
  assert.deepEqual(result.blockers, [{
    id: 'verification-freshness:current-fingerprint-missing',
    artifact: 'case-minimal',
    detail: 'browser_project'
  }]);
});

test('mtime-only input cannot produce fresh', () => {
  const request = makeRequest();
  request.currentFingerprints = {
    mtime: '2026-07-31T20:50:00Z'
  };

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.ok(result.blockers.length > 0);
  assert.equal(
    result.blockers.every((entry) => (
      entry.id === 'verification-freshness:current-fingerprint-missing'
    )),
    true
  );
});

test('latest attempt is selected independently for every approved case', () => {
  const request = makeRequest();
  const secondCase = structuredClone(request.caseSnapshot.cases[0]);
  secondCase.id = 'case-second';
  request.caseSnapshot.cases.push(secondCase);
  request.run.case_ids.push(secondCase.id);

  const oldAttempt = structuredClone(request.attempts[0]);
  oldAttempt.id = 'attempt-old';
  oldAttempt.sequence = 1;
  oldAttempt.browser_project = 'webkit';
  const latestAttempt = structuredClone(request.attempts[0]);
  latestAttempt.id = 'attempt-latest';
  latestAttempt.sequence = 2;
  const secondAttempt = structuredClone(request.attempts[0]);
  secondAttempt.id = 'attempt-second';
  secondAttempt.case_id = secondCase.id;
  request.attempts = [oldAttempt, latestAttempt, secondAttempt];
  request.currentFingerprints.cases[secondCase.id] = {
    browser_project: secondAttempt.browser_project,
    test_data_snapshot: '9'.repeat(64)
  };

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'stale');
  assert.deepEqual(
    result.cases.map((entry) => ({
      case_id: entry.case_id,
      attempt_id: entry.attempt_id,
      status: entry.status
    })),
    [
      {
        case_id: 'case-minimal',
        attempt_id: 'attempt-latest',
        status: 'fresh'
      },
      {
        case_id: 'case-second',
        attempt_id: 'attempt-second',
        status: 'stale'
      }
    ]
  );
});

test('snapshot artifact and run hash mismatch blocks every case', () => {
  const request = makeRequest();
  request.caseSnapshot.snapshot_hash = '9'.repeat(64);

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.equal(result.cases[0].status, 'unknown');
  assert.deepEqual(result.cases[0].reasons, [
    'case_snapshot_hash:source-conflict'
  ]);
  assert.deepEqual(result.blockers, [{
    id: 'verification-freshness:snapshot-run-mismatch',
    artifact: 'case-minimal',
    detail: 'case_snapshot_hash'
  }]);
});

test('tied latest attempts are ambiguous instead of selected by id', () => {
  const request = makeRequest();
  const duplicate = structuredClone(request.attempts[0]);
  duplicate.id = 'attempt-duplicate';
  request.attempts.push(duplicate);

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.equal(result.cases[0].attempt_id, null);
  assert.deepEqual(result.cases[0].reasons, ['attempt:ambiguous']);
  assert.deepEqual(result.blockers, [{
    id: 'verification-freshness:attempt-ambiguous',
    artifact: 'case-minimal',
    detail: 'sequence:1'
  }]);
});

test('an empty approved snapshot cannot produce a fresh summary', () => {
  const request = makeRequest();
  request.caseSnapshot.cases = [];
  request.run.case_ids = [];

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.deepEqual(result.blockers, [{
    id: 'verification-freshness:request-invalid',
    artifact: 'case-freshness',
    detail: 'case-snapshot-empty'
  }]);
});

test('shared evidence freshness fails closed when source fingerprints are missing', () => {
  const current = makeRequest().currentFingerprints;
  delete current.cases;
  const evidence = { id: 'evidence-missing-source' };

  assert.doesNotThrow(() => {
    const result = evaluateFreshness(
      evidence,
      current,
      () => '2026-07-31T20:50:00Z'
    );
    assert.equal(result.ok, false);
    assert.equal(result.freshness.status, 'unknown');
    assert.equal(
      result.blockers[0].id,
      'verification-evidence:source-fingerprint-incomplete'
    );
  });
});

test('attempts from another run or change cannot become the latest case source', () => {
  const request = makeRequest();
  const foreign = structuredClone(request.attempts[0]);
  foreign.id = 'attempt-foreign';
  foreign.run_id = 'run-foreign';
  foreign.change_id = 'change-foreign';
  foreign.sequence = 99;
  foreign.browser_project = 'webkit';
  request.attempts.push(foreign);

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, true);
  assert.equal(result.cases[0].attempt_id, 'attempt-minimal');
  assert.equal(result.cases[0].status, 'fresh');
});

test('missing run fingerprints cannot be supplied implicitly by an attempt', () => {
  const request = makeRequest();
  delete request.run.code_sha;

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.equal(result.cases[0].status, 'unknown');
  assert.deepEqual(result.cases[0].reasons, ['code_sha:source-missing']);
  assert.deepEqual(result.blockers, [{
    id: 'verification-freshness:source-fingerprint-missing',
    artifact: 'case-minimal',
    detail: 'code_sha'
  }]);
});

test('missing run and attempt identities cannot compare as equal', () => {
  const request = makeRequest();
  delete request.run.id;
  delete request.run.change_id;
  delete request.attempts[0].run_id;
  delete request.attempts[0].change_id;

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.deepEqual(result.blockers, [{
    id: 'verification-freshness:request-invalid',
    artifact: 'case-freshness',
    detail: 'run-identity-invalid'
  }]);
});

test('a selected attempt without a stable id blocks the case', () => {
  const request = makeRequest();
  delete request.attempts[0].id;

  const result = evaluator().evaluate(request);

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'unknown');
  assert.equal(result.cases[0].attempt_id, null);
  assert.deepEqual(result.cases[0].reasons, ['attempt:identity-missing']);
  assert.deepEqual(result.blockers, [{
    id: 'verification-freshness:attempt-identity-missing',
    artifact: 'case-minimal',
    detail: 'id'
  }]);
});

test('string or non-positive attempt sequences fail closed', () => {
  for (const invalidSequence of ['1', 0, -1, 1.5]) {
    const request = makeRequest();
    const invalid = structuredClone(request.attempts[0]);
    invalid.id = `attempt-invalid-${String(invalidSequence)}`;
    invalid.sequence = invalidSequence;
    request.attempts.push(invalid);

    const result = evaluator().evaluate(request);

    assert.equal(result.ok, false);
    assert.equal(result.summary.status, 'unknown');
    assert.equal(result.cases[0].attempt_id, null);
    assert.deepEqual(result.cases[0].reasons, ['attempt:ambiguous']);
    assert.deepEqual(result.blockers, [{
      id: 'verification-freshness:attempt-ambiguous',
      artifact: 'case-minimal',
      detail: 'sequence:invalid'
    }]);
  }
});

test('evaluation never mutates caller-owned artifacts', () => {
  const request = makeRequest();
  const before = structuredClone(request);

  evaluator().evaluate(request);

  assert.deepEqual(request, before);
});

test('hostile request values fail closed without throwing', () => {
  const request = makeRequest();
  request.attempts = new Proxy([], {
    ownKeys() {
      throw new Error('hostile');
    }
  });

  assert.doesNotThrow(() => {
    const result = evaluator().evaluate(request);
    assert.equal(result.ok, false);
    assert.equal(result.summary.status, 'unknown');
    assert.deepEqual(result.blockers, [{
      id: 'verification-freshness:request-invalid',
      artifact: 'case-freshness',
      detail: 'request-unreadable'
    }]);
  });
});
