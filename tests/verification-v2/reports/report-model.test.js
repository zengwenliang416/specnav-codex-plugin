'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification');
const {
  canonicalJson,
  sha256
} = require('../../../plugins/specnav-verification/kernel/evidence/identity');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');
const {
  computeSnapshotHash
} = require('../../../plugins/specnav-verification/kernel/cases/snapshot-writer');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures/positive'
);
const FIXED_TIME = '2026-08-01T08:20:00.000Z';
const SIX_DOMAINS = kernel.SIX_DOMAINS;

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, `${name}.json`),
    'utf8'
  ));
}

function reading(domain, verdict = 'pass') {
  const base = fixture('reading');
  return {
    ...base,
    id: `reading-${domain}`,
    domain,
    evidence_ids: [`evidence-${domain}`],
    verdict,
    actual: verdict === 'pass'
  };
}

function evidenceFor(source) {
  return {
    schema: 'specnav.verification.evidence.v1',
    id: source.evidence_ids[0],
    kind: 'structured_comparison',
    path: `objects/${source.evidence_ids[0]}.json`,
    sha256: '3'.repeat(64),
    size: 42,
    producer: 'command-runner',
    captured_at: '2026-07-31T00:00:01Z',
    change_id: source.change_id,
    run_id: source.run_id,
    case_id: source.case_id,
    attempt_id: source.attempt_id,
    step_id: source.step_id,
    code_sha: source.code_sha,
    test_sha: source.test_sha,
    environment_hash: 'd'.repeat(64),
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    domain: source.domain,
    result: source.verdict === 'pass' ? 'pass' : 'fail'
  };
}

function integrityFor(evidence, overrides = {}) {
  return {
    ok: true,
    facts: {
      summary: {
        evidence_count: evidence.length,
        integrity: 'intact',
        freshness: 'fresh'
      },
      evidence: evidence.map((entry) => ({
        evidence_id: entry.id,
        integrity: 'intact',
        freshness: 'fresh',
        exists: true,
        hash_match: true,
        size_match: true,
        producer_recognized: true,
        store_record_match: true,
        binding_match: true,
        path_safe: true,
        ...overrides
      }))
    },
    blockers: []
  };
}

function rawBytesFor(entries) {
  return Buffer.from(`${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

function indexEntriesFor(entries) {
  return [...entries].sort((left, right) => (
    String(left.captured_at).localeCompare(String(right.captured_at))
    || String(left.id).localeCompare(String(right.id))
  ));
}

function aggregationRequest(state = 'pass') {
  const readings = SIX_DOMAINS.map((domain) => (
    reading(domain, state === 'fail' && domain === 'unit' ? 'fail' : 'pass')
  ));
  const evidence = readings.map(evidenceFor);
  const terminalStates = [
    'flaky',
    'pass_after_fix',
    'stale',
    'canceled'
  ].includes(state)
    ? [{
        id: `terminal-${state}`,
        case_id: 'case-minimal',
        status: state,
        source_reading_ids: readings.map((entry) => entry.id)
      }]
    : [];
  return {
    change_id: 'change-v2',
    case_ids: ['case-minimal'],
    readings,
    evidence,
    integrity: integrityFor(evidence),
    policy_facts: {
      not_applicable_decisions: [],
      terminal_states: terminalStates
    }
  };
}

function stack(state = 'pass') {
  if (state === 'flaky') return flakyStack();
  if (state === 'pass_after_fix') return passAfterFixStack();
  const schemaRegistry = readySchemaRegistry();
  const aggregateRequest = aggregationRequest(state);
  const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
  const aggregate = aggregator.aggregate(aggregateRequest);
  const caseSnapshot = fixture('case-snapshot');
  caseSnapshot.snapshot_hash = computeSnapshotHash(caseSnapshot);
  const run = {
    ...fixture('verification-run'),
    case_snapshot_hash: caseSnapshot.snapshot_hash,
    status: state === 'running'
      ? 'running'
      : state === 'canceled'
        ? 'canceled'
        : state === 'fail'
          ? 'failed'
          : 'passed',
    started_at: '2026-07-31T00:00:00Z',
    completed_at: state === 'running' ? null : '2026-07-31T00:00:02Z'
  };
  const attempt = {
    ...fixture('attempt'),
    case_snapshot_hash: caseSnapshot.snapshot_hash,
    status: run.status === 'passed'
      ? 'passed'
      : run.status === 'failed'
        ? 'failed'
        : run.status,
    completed_at: run.completed_at,
    exit_status: run.status === 'passed'
      ? 0
      : run.status === 'failed'
        ? 1
        : null
  };
  const evidenceIndex = {
    ...fixture('evidence-index'),
    source_raw: 'raw.jsonl',
    record_count: aggregateRequest.evidence.length,
    entries: indexEntriesFor(aggregateRequest.evidence)
  };
  evidenceIndex.source_digest = sha256(rawBytesFor(evidenceIndex.entries));
  const freshness = {
    ok: state !== 'stale',
    checked_at: '2026-08-01T08:19:00Z',
    summary: {
      status: state === 'stale' ? 'stale' : 'fresh',
      total: 1,
      fresh: state === 'stale' ? 0 : 1,
      stale: state === 'stale' ? 1 : 0,
      unknown: 0
    },
    cases: [{
      case_id: 'case-minimal',
      attempt_id: 'attempt-minimal',
      checked_at: '2026-08-01T08:19:00Z',
      status: state === 'stale' ? 'stale' : 'fresh',
      reasons: state === 'stale' ? ['code_sha:mismatch'] : []
    }],
    blockers: state === 'stale'
      ? [{
          id: 'verification-freshness:fingerprint-mismatch',
          artifact: 'case-minimal',
          detail: 'code_sha'
        }]
      : []
  };
  const gateEngine = kernel.createDecisionEngine({
    schemaRegistry,
    aggregator,
    clock: () => '2026-08-01T08:19:30Z'
  });
  const gateResult = gateEngine.decide({
    change_id: 'change-v2',
    stage: 'release',
    aggregation_request: aggregateRequest,
    evidence_index_version: evidenceIndex.index_version,
    runtime_version: run.runtime_version,
    kernel_version: run.kernel_version,
    freshness: {
      status: freshness.summary.status,
      checked_at: freshness.checked_at,
      reasons: freshness.cases.flatMap((entry) => entry.reasons)
    },
    integrity_status: 'intact',
    policy_version: 'verification-policy-v1',
    open_failure_ids: state === 'fail' ? ['failure-minimal'] : []
  });
  const failures = state === 'fail'
    ? [{
        ...fixture('failure-packet'),
        reading_ids: aggregateRequest.readings.map((entry) => entry.id),
        evidence_ids: aggregateRequest.evidence.map((entry) => entry.id)
      }]
    : [];
  return {
    schemaRegistry,
    request: {
      change_id: 'change-v2',
      case_snapshot: caseSnapshot,
      runs: [run],
      attempts: [attempt],
      readings: aggregateRequest.readings,
      evidence_index: evidenceIndex,
      integrity: aggregateRequest.integrity,
      policy_facts: aggregateRequest.policy_facts,
      aggregate,
      freshness,
      failures,
      repair_links: [],
      gate_decision: gateResult.gate
    }
  };
}

function executionIdentity(attempt) {
  return {
    case_snapshot_hash: attempt.case_snapshot_hash,
    code_sha: attempt.code_sha,
    test_sha: attempt.test_sha,
    environment_hash: attempt.environment_hash,
    runtime_version: attempt.runtime_version,
    kernel_version: attempt.kernel_version
  };
}

function refreshRequest(schemaRegistry, request) {
  request.evidence_index.entries = indexEntriesFor(
    request.evidence_index.entries
  );
  request.integrity = integrityFor(request.evidence_index.entries);
  request.evidence_index.record_count = request.evidence_index.entries.length;
  request.evidence_index.source_digest = sha256(rawBytesFor(
    request.evidence_index.entries
  ));
  const latest = [...request.attempts].sort((left, right) => (
    left.sequence - right.sequence
    || left.started_at.localeCompare(right.started_at)
    || left.id.localeCompare(right.id)
  )).at(-1);
  const latestRun = [...request.runs].sort((left, right) => (
    Date.parse(left.created_at) - Date.parse(right.created_at)
    || left.id.localeCompare(right.id)
  )).at(-1);
  request.freshness.cases[0].attempt_id = latest.id;
  const current = request.readings.filter((entry) => (
    entry.attempt_id === latest.id
  ));
  const aggregationInput = {
    change_id: request.change_id,
    case_ids: request.case_snapshot.cases.map((entry) => entry.id),
    readings: current,
    evidence: request.evidence_index.entries,
    integrity: request.integrity,
    policy_facts: request.policy_facts
  };
  const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
  request.aggregate = aggregator.aggregate(aggregationInput);
  const gateEngine = kernel.createDecisionEngine({
    schemaRegistry,
    aggregator,
    clock: () => '2026-08-01T08:19:30Z'
  });
  request.gate_decision = gateEngine.decide({
    change_id: request.change_id,
    stage: 'release',
    aggregation_request: aggregationInput,
    evidence_index_version: request.evidence_index.index_version,
    runtime_version: latestRun.runtime_version,
    kernel_version: latestRun.kernel_version,
    freshness: {
      status: request.freshness.summary.status,
      checked_at: request.freshness.checked_at,
      reasons: request.freshness.cases.flatMap((entry) => entry.reasons)
    },
    integrity_status: 'intact',
    policy_version: 'verification-policy-v1',
    open_failure_ids: []
  }).gate;
  return { schemaRegistry, request };
}

function replaceGateFreshness(schemaRegistry, request, freshness) {
  const latestRun = [...request.runs].sort((left, right) => (
    Date.parse(left.created_at) - Date.parse(right.created_at)
    || left.id.localeCompare(right.id)
  )).at(-1);
  const latestAttempt = [...request.attempts].sort((left, right) => (
    left.sequence - right.sequence
    || left.started_at.localeCompare(right.started_at)
    || left.id.localeCompare(right.id)
  )).at(-1);
  const readings = request.readings.filter((entry) => (
    entry.attempt_id === latestAttempt.id
  ));
  const aggregationRequest = {
    change_id: request.change_id,
    case_ids: request.case_snapshot.cases.map((entry) => entry.id),
    readings,
    evidence: request.evidence_index.entries,
    integrity: request.integrity,
    policy_facts: request.policy_facts
  };
  const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
  const gateEngine = kernel.createDecisionEngine({
    schemaRegistry,
    aggregator,
    clock: () => '2026-08-01T08:19:30Z'
  });
  request.gate_decision = gateEngine.decide({
    change_id: request.change_id,
    stage: 'release',
    aggregation_request: aggregationRequest,
    evidence_index_version: request.evidence_index.index_version,
    runtime_version: latestRun.runtime_version,
    kernel_version: latestRun.kernel_version,
    freshness,
    integrity_status: 'intact',
    policy_version: 'verification-policy-v1',
    open_failure_ids: []
  }).gate;
}

function flakyStack() {
  const { schemaRegistry, request } = stack('pass');
  const retry = {
    ...request.attempts[0],
    kind: 'retry',
    sequence: 2,
    parent_attempt_id: 'attempt-failed'
  };
  const failed = {
    ...request.attempts[0],
    id: 'attempt-failed',
    status: 'failed',
    completed_at: '2026-07-31T00:00:00.500Z',
    exit_status: 1
  };
  request.attempts = [failed, retry];
  request.policy_facts.terminal_states = [{
    id: 'terminal-flaky',
    case_id: 'case-minimal',
    status: 'flaky',
    source_reading_ids: request.readings.map((entry) => entry.id)
  }];
  return refreshRequest(schemaRegistry, request);
}

function passAfterFixStack() {
  const { schemaRegistry, request } = stack('pass');
  const regression = {
    ...request.attempts[0],
    kind: 'regression',
    sequence: 3,
    parent_attempt_id: 'attempt-retest'
  };
  const retest = {
    ...request.attempts[0],
    id: 'attempt-retest',
    kind: 'retest',
    sequence: 2,
    parent_attempt_id: 'attempt-failed'
  };
  const failed = {
    ...request.attempts[0],
    id: 'attempt-failed',
    status: 'failed',
    completed_at: '2026-07-31T00:00:00.500Z',
    exit_status: 1
  };
  const historical = [];
  for (const source of request.readings) {
    for (const [attempt, suffix, verdict] of [
      [failed, 'failed', source.domain === 'unit' ? 'fail' : 'pass'],
      [retest, 'retest', 'pass']
    ]) {
      const historicalReading = {
        ...source,
        id: `${source.id}-${suffix}`,
        attempt_id: attempt.id,
        evidence_ids: [`${source.evidence_ids[0]}-${suffix}`],
        verdict,
        actual: verdict === 'pass'
      };
      historical.push(historicalReading);
    }
  }
  const historicalEvidence = historical.map(evidenceFor);
  request.attempts = [failed, retest, regression];
  request.readings = [...historical, ...request.readings];
  request.evidence_index.entries = [
    ...historicalEvidence,
    ...request.evidence_index.entries
  ];
  const failedReadings = historical.filter((entry) => (
    entry.attempt_id === failed.id
  ));
  request.failures = [{
    ...fixture('failure-packet'),
    attempt_id: failed.id,
    reading_ids: failedReadings.map((entry) => entry.id),
    evidence_ids: failedReadings.flatMap((entry) => entry.evidence_ids),
    status: 'verified'
  }];
  const retestEvidenceIds = historical.filter((entry) => (
    entry.attempt_id === retest.id
  )).flatMap((entry) => entry.evidence_ids);
  request.repair_links = [{
    ...fixture('repair-link'),
    status: 'completed',
    completed_at: '2026-07-31T00:00:03Z',
    before_identity: executionIdentity(failed),
    after_identity: executionIdentity(retest),
    review_evidence_ids: retestEvidenceIds.slice(0, 2)
  }];
  request.policy_facts.terminal_states = [{
    id: 'terminal-pass_after_fix',
    case_id: 'case-minimal',
    status: 'pass_after_fix',
    source_reading_ids: request.readings.filter((entry) => (
      entry.attempt_id === regression.id
    )).map((entry) => entry.id)
  }];
  return refreshRequest(schemaRegistry, request);
}

function builder(schemaRegistry, authoritativeRequest = {}) {
  const authoritySnapshot = structuredClone(authoritativeRequest);
  const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
  const decisionEngine = kernel.createDecisionEngine({
    schemaRegistry,
    aggregator,
    clock: () => '2026-08-01T08:19:30Z'
  });
  return kernel.createReportModelBuilder({
    schemaRegistry,
    aggregator,
    decisionEngine,
    evidenceIndexAuthority: kernel.createEvidenceIndexAuthority({
      readRaw: () => rawBytesFor(
        authoritySnapshot.evidence_index?.entries || []
      )
    }),
    factAuthority: kernel.createReportFactAuthority({
      verifyIntegrity: (payload) => (
        canonicalJson(payload.integrity ?? null)
        === canonicalJson(authoritySnapshot.integrity ?? null)
      ),
      verifyFreshness: (payload) => (
        canonicalJson(payload.freshness ?? null)
        === canonicalJson(authoritySnapshot.freshness ?? null)
      )
    }),
    gateContextAuthority: {
      resolve(changeId) {
        return {
          ok: true,
          change_id: changeId,
          stage: 'release',
          policy_version: 'verification-policy-v1'
        };
      }
    },
    secretRedactor: kernel.createSecretRedactor({ secrets: [] }),
    clock: () => FIXED_TIME
  });
}

test('builds one deterministic immutable rich model for all three pages', () => {
  const { schemaRegistry, request } = stack('pass');
  const before = structuredClone(request);
  const first = builder(schemaRegistry, request).build(request);
  const second = builder(schemaRegistry, request).build(structuredClone(request));

  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(first.model.verdict, 'green');
  assert.equal(first.model.id, second.model.id);
  assert.deepEqual(request, before);
  assert.equal(Object.isFrozen(first.model), true);
  assert.equal(first.model.catalog.length, 1);
  assert.deepEqual(first.model.catalog[0].steps, request.case_snapshot.cases[0].steps);
  assert.equal(first.model.results.length, 1);
  assert.equal(first.model.results[0].attempts.length, 1);
  assert.equal(first.model.results[0].readings.length, 6);
  assert.equal(first.model.results[0].evidence.length, 6);
  assert.equal(first.model.results[0].evidence[0].available, true);
  assert.match(first.model.results[0].evidence[0].href, /^evidence\//);
  assert.equal(schemaRegistry.validate('report-model', first.model).ok, true);
});

test('derives every verdict without accepting caller-authored summary state', () => {
  const expected = new Map([
    ['pass', 'green'],
    ['fail', 'red'],
    ['stale', 'stale'],
    ['flaky', 'flaky'],
    ['pass_after_fix', 'pass_after_fix'],
    ['canceled', 'canceled']
  ]);
  for (const [state, verdict] of expected) {
    const { schemaRegistry, request } = stack(state);
    request.verdict = 'green';
    request.summary = { domains: { unit: 'pass' } };
    request.totals = { cases: 0 };
    const result = builder(schemaRegistry, request).build(request);
    assert.equal(result.model.verdict, verdict, state);
  }

  const running = stack('pass');
  running.request.runs[0].status = 'running';
  running.request.runs[0].completed_at = null;
  running.request.attempts[0].status = 'running';
  running.request.attempts[0].completed_at = null;
  running.request.attempts[0].exit_status = null;
  running.request.aggregate = null;
  running.request.gate_decision = null;
  assert.equal(
    builder(running.schemaRegistry, running.request)
      .build(running.request).model.verdict,
    'running'
  );

  const blockedRequest = {
    change_id: 'change-v2'
  };
  const blocked = builder(readySchemaRegistry(), blockedRequest)
    .build(blockedRequest);
  assert.equal(blocked.model.verdict, 'blocked');
  assert.equal(blocked.model.catalog.length, 0);
  assert.equal(blocked.model.results.length, 0);
});

test('preserves failed and repaired history and derives pass after fix', () => {
  const { schemaRegistry, request } = stack('pass_after_fix');

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.blockers, []);
  assert.equal(result.model.verdict, 'pass_after_fix');
  assert.deepEqual(
    result.model.results[0].attempts.map((entry) => entry.kind),
    ['initial', 'retest', 'regression']
  );
  assert.equal(result.model.results[0].failures.length, 1);
  assert.equal(result.model.results[0].repairs.length, 1);
  assert.equal(result.model.summary.repair_loop.status, 'closed');
});

test('missing or broken evidence produces no valid-looking link', () => {
  const { schemaRegistry, request } = stack('pass');
  request.integrity = integrityFor(request.evidence_index.entries, {
    exists: false,
    integrity: 'broken'
  });

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.equal(
    result.model.results[0].evidence.every((entry) => (
      entry.available === false && entry.href === null
    )),
    true
  );
  assert.equal(result.model.blockers.some((entry) => (
    entry.id === 'verification-report:evidence-unavailable'
  )), true);
});

test('rejects mismatched source bindings and duplicate immutable ids', () => {
  const { schemaRegistry, request } = stack('pass');
  request.readings[0].run_id = 'run-foreign';
  request.attempts.push(structuredClone(request.attempts[0]));

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:source-binding-mismatch'
  )), true);
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:duplicate-id'
  )), true);
});

test('trusted recomputation rejects caller-forged aggregate and gate green', () => {
  const { schemaRegistry, request } = stack('pass');
  const failed = request.readings.find((entry) => entry.domain === 'unit');
  failed.verdict = 'fail';
  failed.actual = false;
  request.evidence_index.entries.find((entry) => (
    entry.id === failed.evidence_ids[0]
  )).result = 'fail';
  request.evidence_index.source_digest = sha256(rawBytesFor(
    request.evidence_index.entries
  ));

  const result = builder(schemaRegistry, request).build(request);

  assert.notEqual(result.model.verdict, 'green');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:aggregate-authority-mismatch'
  )), true);
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:gate-authority-mismatch'
  )), true);
});

test('controlled evidence locator rejects URI schemes and encoded traversal', () => {
  for (const unsafePath of [
    'javascript:alert(1)',
    'objects/%2e%2e/secrets.txt',
    'reports/result.html',
    'objects//evidence.json'
  ]) {
    const { schemaRegistry, request } = stack('pass');
    const unsafeEvidence = request.evidence_index.entries[0];
    unsafeEvidence.path = unsafePath;
    request.evidence_index.source_digest = sha256(rawBytesFor(
      request.evidence_index.entries
    ));

    const result = builder(schemaRegistry, request).build(request);

    assert.equal(result.model.verdict, 'blocked', unsafePath);
    assert.equal(
      result.model.results[0].evidence.find((entry) => (
        entry.id === unsafeEvidence.id
      )).href,
      null,
      unsafePath
    );
    assert.equal(result.blockers.some((entry) => (
      entry.id === 'verification-report:evidence-path-unsafe'
    )), true, unsafePath);
  }
});

test('duplicate evidence ids block instead of folding immutable history', () => {
  const { schemaRegistry, request } = stack('pass');
  const duplicate = structuredClone(request.evidence_index.entries[0]);
  duplicate.path = 'objects/conflicting-evidence.json';
  duplicate.sha256 = '9'.repeat(64);
  duplicate.size = 99;
  request.evidence_index.entries.push(duplicate);
  request.evidence_index.record_count += 1;
  request.evidence_index.source_digest = sha256(rawBytesFor(
    request.evidence_index.entries
  ));

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:duplicate-id'
    && entry.artifact === duplicate.id
  )), true);
});

test('rejects missing and forged authority collaborators without fallback', () => {
  const { schemaRegistry, request } = stack('pass');
  assert.throws(
    () => kernel.createReportModelBuilder({ schemaRegistry }),
    /verification-report:config-invalid/
  );

  assert.throws(() => kernel.createReportModelBuilder({
    schemaRegistry,
    aggregator: { aggregate: () => request.aggregate },
    decisionEngine: { decide: () => ({ ok: true, gate: request.gate_decision }) },
    evidenceIndexAuthority: { verify: () => ({ ok: true }) },
    factAuthority: {
      verifyIntegrity: () => ({ ok: true }),
      verifyFreshness: () => ({ ok: true })
    },
    gateContextAuthority: {
      resolve: () => ({
        ok: true,
        change_id: 'change-v2',
        stage: 'release',
        policy_version: 'verification-policy-v1'
      })
    },
    secretRedactor: kernel.createSecretRedactor({ secrets: [] }),
    clock: () => FIXED_TIME
  }), /verification-report:config-invalid/);

  const result = kernel.createReportModelBuilder({
    schemaRegistry,
    aggregator: { aggregate: () => request.aggregate },
    decisionEngine: { decide: () => ({ ok: true, gate: request.gate_decision }) },
    evidenceIndexAuthority: kernel.createEvidenceIndexAuthority({
      readRaw: () => Buffer.from('')
    }),
    factAuthority: kernel.createReportFactAuthority({
      verifyIntegrity: () => true,
      verifyFreshness: () => true
    }),
    gateContextAuthority: {
      resolve: () => ({
        ok: true,
        change_id: 'change-v2',
        stage: 'release',
        policy_version: 'verification-policy-v1'
      })
    },
    secretRedactor: kernel.createSecretRedactor({ secrets: [] }),
    clock: () => FIXED_TIME
  }).build(request);

  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:evidence-index-unverified'
  )), true);
});

test('failure history must bind to current run attempt readings and evidence', () => {
  const { schemaRegistry, request } = stack('pass');
  request.failures = [{
    ...fixture('failure-packet'),
    status: 'verified',
    reading_ids: ['reading-missing'],
    evidence_ids: ['evidence-missing']
  }];

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:source-binding-mismatch'
    && entry.artifact === 'failure-minimal'
  )), true);
});

test('repair history must resolve to a verified same-change failure', () => {
  const { schemaRegistry, request } = stack('pass');
  request.repair_links = [{
    ...fixture('repair-link'),
    failure_id: 'failure-missing'
  }];

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:source-binding-mismatch'
    && entry.artifact === 'repair-minimal'
  )), true);
});

test('binds the Evidence Index to the exact change and canonical raw source', () => {
  for (const mutate of [
    (request) => {
      request.evidence_index.change_id = 'change-foreign';
    },
    (request) => {
      request.evidence_index.source_raw = 'foreign/raw.jsonl';
    }
  ]) {
    const { schemaRegistry, request } = stack('pass');
    mutate(request);

    const result = builder(schemaRegistry, request).build(request);

    assert.equal(result.ok, false);
    assert.equal(result.model.verdict, 'blocked');
    assert.equal(result.blockers.some((entry) => (
      entry.id === 'verification-report:evidence-index-unverified'
      || (
        entry.id === 'verification-report:source-binding-mismatch'
        && entry.artifact === 'evidence-index'
      )
    )), true);
  }
});

test('gate stage and policy come from independent authority', () => {
  const { schemaRegistry, request } = stack('pass');
  request.gate_decision = {
    ...request.gate_decision,
    id: 'gate-forged-archive',
    stage: 'archive'
  };

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.notEqual(result.model.summary.lifecycle_status, 'archived');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:gate-authority-mismatch'
  )), true);
});

test('redacts command secrets in every projection and never exposes absolute cwd', () => {
  const { schemaRegistry, request } = stack('pass');
  request.case_snapshot.cases[0].runner.args = [
    '--api-key=sk_live_report_secret',
    'token=unknown_credential_value_1234567890'
  ];
  request.case_snapshot.snapshot_hash = computeSnapshotHash(
    request.case_snapshot
  );
  request.runs[0].case_snapshot_hash = request.case_snapshot.snapshot_hash;
  request.attempts[0].case_snapshot_hash = request.case_snapshot.snapshot_hash;

  const result = builder(schemaRegistry, request).build(request);
  const serialized = JSON.stringify(result.model);

  assert.notEqual(result.model, null, JSON.stringify(result.blockers));
  assert.equal(serialized.includes('sk_live_report_secret'), false);
  assert.equal(serialized.includes('unknown_credential_value_1234567890'), false);
  assert.match(result.model.catalog[0].runner.args[0], /REDACTED/);
  assert.match(result.model.results[0].command.args[1], /REDACTED/);

  const absolute = stack('pass');
  absolute.request.case_snapshot.cases[0].runner.cwd =
    '/Users/private-user/projects/secret-repo';
  absolute.request.case_snapshot.snapshot_hash = computeSnapshotHash(
    absolute.request.case_snapshot
  );
  absolute.request.runs[0].case_snapshot_hash =
    absolute.request.case_snapshot.snapshot_hash;
  absolute.request.attempts[0].case_snapshot_hash =
    absolute.request.case_snapshot.snapshot_hash;

  const blocked = builder(absolute.schemaRegistry, absolute.request)
    .build(absolute.request);

  assert.equal(blocked.ok, false);
  assert.equal(blocked.model.verdict, 'blocked');
  assert.equal(
    JSON.stringify(blocked.model).includes('/Users/private-user'),
    false
  );
});

test('rejects a modified case snapshot that retains an old snapshot hash', () => {
  const { schemaRegistry, request } = stack('pass');
  request.case_snapshot.cases[0].title = 'Forged snapshot content';

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:snapshot-hash-mismatch'
  )), true);
});

test('structural blockers override pass-after-fix and every terminal verdict', () => {
  const { schemaRegistry, request } = stack('pass_after_fix');
  request.readings[0].run_id = 'run-foreign';

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.notEqual(result.blockers.length, 0);
});

test('one chronological run order drives gate, history, and summary versions', () => {
  const { schemaRegistry, request } = stack('pass');
  request.runs.push({
    ...request.runs[0],
    id: 'zz-run-older',
    runtime_version: '9.9.9',
    kernel_version: '9.9.9',
    created_at: '2026-07-30T00:00:00Z',
    started_at: '2026-07-30T00:00:00Z',
    completed_at: '2026-07-30T00:00:01Z'
  });

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.model.summary.runtime_version, '1.0.0');
  assert.equal(result.model.summary.kernel_version, '2.0.0');
  assert.deepEqual(
    result.model.results[0].runs.map((entry) => entry.id),
    ['zz-run-older', 'run-minimal']
  );
});

test('rejects caller-injected pass after fix without repair-loop history', () => {
  const { schemaRegistry, request } = stack('pass');
  request.policy_facts.terminal_states = [{
    id: 'terminal-forged-pass-after-fix',
    case_id: 'case-minimal',
    status: 'pass_after_fix',
    source_reading_ids: request.readings.map((entry) => entry.id)
  }];
  refreshRequest(schemaRegistry, request);

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:terminal-state-unverified'
  )), true);
});

test('reuses complete cross-reference validation for attempt runner bindings', () => {
  const { schemaRegistry, request } = stack('pass');
  request.attempts[0].runner = 'playwright';

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:cross-reference-invalid'
  )), true);
});

test('rejects integrity freshness and raw digest changes outside authorities', () => {
  const { schemaRegistry, request } = stack('pass');
  const trustedBuilder = builder(schemaRegistry, request);
  request.integrity.facts.evidence[0].exists = false;
  request.freshness.summary.status = 'stale';
  request.evidence_index.source_digest = 'f'.repeat(64);

  const result = trustedBuilder.build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  for (const id of [
    'verification-report:evidence-index-unverified',
    'verification-report:integrity-unverified',
    'verification-report:freshness-unverified'
  ]) {
    assert.equal(result.blockers.some((entry) => entry.id === id), true, id);
  }
});

test('malformed authoritative freshness fails closed instead of normalizing green', () => {
  const { schemaRegistry, request } = stack('pass');
  request.freshness.checked_at = 'not-a-date';
  replaceGateFreshness(schemaRegistry, request, {
    status: 'fresh',
    checked_at: FIXED_TIME,
    reasons: []
  });

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:freshness-invalid'
  )), true);
});

test('report-model schema independently rejects unsafe evidence paths and hrefs', () => {
  const { schemaRegistry, request } = stack('pass');
  const result = builder(schemaRegistry, request).build(request);
  assert.equal(result.ok, true, JSON.stringify(result.blockers));

  const unsafe = structuredClone(result.model);
  unsafe.results[0].evidence[0].path = 'objects/%2e%2e/secrets.txt';
  unsafe.results[0].evidence[0].href = 'javascript:alert(1)';

  assert.equal(schemaRegistry.validate('report-model', unsafe).ok, false);
});

test('repair review evidence must come from the successful post-fix chain', () => {
  const { schemaRegistry, request } = stack('pass_after_fix');
  request.repair_links[0].review_evidence_ids = request.evidence_index.entries
    .filter((entry) => entry.attempt_id === 'attempt-failed')
    .slice(0, 2)
    .map((entry) => entry.id);

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, false);
  assert.equal(result.model.verdict, 'blocked');
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report:source-binding-mismatch'
    && entry.artifact === request.repair_links[0].id
  )), true);
});

test('redacts separated CLI credential flags and values', () => {
  const { schemaRegistry, request } = stack('pass');
  request.case_snapshot.cases[0].runner.args = [
    '--api-key',
    'sk_live_separated_secret_1234567890',
    '--token',
    'unknown_credential_value_1234567890'
  ];
  request.case_snapshot.snapshot_hash = computeSnapshotHash(
    request.case_snapshot
  );
  request.runs[0].case_snapshot_hash = request.case_snapshot.snapshot_hash;
  request.attempts[0].case_snapshot_hash = request.case_snapshot.snapshot_hash;

  const result = builder(schemaRegistry, request).build(request);
  const serialized = JSON.stringify(result.model);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(serialized.includes('sk_live_separated_secret'), false);
  assert.equal(serialized.includes('unknown_credential_value'), false);
});

test('orders RFC3339 offsets by epoch instead of text', () => {
  const { schemaRegistry, request } = stack('pass');
  request.runs.push({
    ...request.runs[0],
    id: 'run-offset-later',
    runtime_version: '9.9.9',
    kernel_version: '9.9.9',
    created_at: '2026-07-30T23:30:00-12:00',
    started_at: '2026-07-30T23:30:00-12:00',
    completed_at: '2026-07-30T23:31:00-12:00'
  });
  refreshRequest(schemaRegistry, request);

  const result = builder(schemaRegistry, request).build(request);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.model.summary.runtime_version, '9.9.9');
  assert.deepEqual(
    result.model.results[0].runs.map((entry) => entry.id),
    ['run-minimal', 'run-offset-later']
  );
});
