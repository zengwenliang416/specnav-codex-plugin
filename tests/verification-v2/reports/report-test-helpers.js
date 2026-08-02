'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../contracts/fixtures/positive'
);
const DOMAIN_NAMES = Object.freeze([
  'facticity',
  'static',
  'unit',
  'redteam',
  'e2e',
  'sensory'
]);

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, `${name}.json`),
    'utf8'
  ));
}

function domainStatusFor(verdict) {
  if (verdict === 'green') return 'pass';
  if (verdict === 'red') return 'fail';
  return verdict;
}

function reportModel(verdict = 'green', overrides = {}) {
  const status = domainStatusFor(verdict);
  const model = {
    schema: 'specnav.verification.report-model.v1',
    id: `report-model-${verdict}`,
    change_id: 'verification-2-0',
    model_version: 2,
    generated_at: '2026-08-02T00:00:00Z',
    verdict,
    sources: {
      case_snapshot_id: 'snapshot-001',
      case_snapshot_hash: 'a'.repeat(64),
      run_ids: verdict === 'blocked' ? [] : ['run-001'],
      attempt_ids: verdict === 'blocked' ? [] : ['attempt-001'],
      reading_ids: verdict === 'blocked' ? [] : ['reading-001'],
      evidence_ids: verdict === 'blocked' ? [] : ['evidence-001'],
      evidence_index_version: verdict === 'blocked' ? null : 1,
      evidence_index_digest: verdict === 'blocked'
        ? null
        : 'b'.repeat(64),
      aggregate_id: verdict === 'blocked' ? null : 'aggregate-001',
      gate_decision_id: verdict === 'running' || verdict === 'blocked'
        ? null
        : 'gate-001'
    },
    summary: {
      lifecycle_status: verdict === 'green'
        ? 'released'
        : verdict === 'running'
          ? 'running'
          : verdict === 'blocked'
            ? 'planned'
            : 'terminal',
      domains: Object.fromEntries(DOMAIN_NAMES.map((domain) => [
        domain,
        status
      ])),
      totals: {
        cases: verdict === 'blocked' ? 0 : 1,
        runs: verdict === 'blocked' ? 0 : 1,
        attempts: verdict === 'blocked' ? 0 : 1,
        readings: verdict === 'blocked' ? 0 : 6,
        evidence: verdict === 'blocked' ? 0 : 6,
        failures: ['red', 'pass_after_fix'].includes(verdict) ? 1 : 0,
        repairs: verdict === 'pass_after_fix' ? 1 : 0
      },
      integrity: verdict === 'blocked' ? 'unknown' : 'intact',
      freshness: {
        status: verdict === 'stale'
          ? 'stale'
          : verdict === 'blocked'
            ? 'unknown'
            : 'fresh',
        checked_at: '2026-08-02T00:00:00Z',
        reasons: verdict === 'stale' ? ['code_sha:mismatch'] : []
      },
      repair_loop: {
        status: verdict === 'pass_after_fix'
          ? 'closed'
          : verdict === 'red'
            ? 'open'
            : verdict === 'blocked'
              ? 'not_started'
              : 'closed',
        failure_ids: ['red', 'pass_after_fix'].includes(verdict)
          ? ['failure-001']
          : [],
        repair_ids: verdict === 'pass_after_fix' ? ['repair-001'] : [],
        history_event_count: verdict === 'pass_after_fix' ? 5 : 0
      },
      open_failure_ids: verdict === 'red' ? ['failure-001'] : [],
      open_repair_ids: [],
      runtime_version: verdict === 'blocked' ? null : '2.0.0',
      kernel_version: '2.0.0-alpha.1'
    },
    catalog: [],
    results: [],
    blockers: verdict === 'blocked'
      ? [{
          id: 'verification-runtime:not-ready',
          artifact: 'runtime-status.json',
          detail: 'Run the managed runtime setup command.'
        }]
      : [],
    warnings: verdict === 'flaky'
      ? [{
          id: 'verification-report:flaky',
          artifact: 'case-001',
          detail: 'Retry passed after the initial attempt failed.'
        }]
      : []
  };
  return Object.assign(model, structuredClone(overrides));
}

function caseHistory() {
  const testCase = fixture('test-case');
  const run = {
    ...fixture('verification-run'),
    status: 'passed',
    started_at: '2026-07-31T00:00:00Z',
    completed_at: '2026-07-31T00:00:02Z'
  };
  const attempt = fixture('attempt');
  const readings = DOMAIN_NAMES.map((domain) => ({
    ...fixture('reading'),
    id: `reading-${domain}`,
    domain,
    evidence_ids: [`evidence-${domain}`]
  }));
  const evidence = readings.map((entry) => ({
    id: entry.evidence_ids[0],
    kind: 'structured_comparison',
    path: `objects/${entry.evidence_ids[0]}.json`,
    href: `evidence/objects/${entry.evidence_ids[0]}.json`,
    available: true,
    integrity: 'intact',
    freshness: 'fresh',
    sha256: '3'.repeat(64),
    size: 42,
    producer: 'command-runner',
    captured_at: '2026-07-31T00:00:01Z',
    run_id: run.id,
    case_id: testCase.id,
    attempt_id: attempt.id,
    code_sha: attempt.code_sha,
    test_sha: attempt.test_sha,
    redaction: {
      status: 'not_required',
      redacted_fields: []
    }
  }));
  return {
    catalog: [testCase],
    results: [{
      case_id: testCase.id,
      status: 'pass',
      freshness: 'fresh',
      command: {
        runner: testCase.runner.kind,
        entrypoint: testCase.runner.entrypoint,
        args: testCase.runner.args,
        cwd: testCase.runner.cwd,
        env_keys: testCase.runner.env_keys
      },
      runs: [run],
      attempts: [attempt],
      readings,
      evidence,
      failures: [],
      repairs: [],
      blockers: []
    }]
  };
}

function validatedReportModel(verdict = 'green', overrides = {}, options = {}) {
  const registry = readySchemaRegistry();
  const history = options.includeCaseHistory ? caseHistory() : {};
  const validation = registry.validate(
    'report-model',
    reportModel(verdict, {
      ...history,
      ...overrides
    })
  );
  if (!validation.ok) {
    throw new Error(JSON.stringify(validation.blockers));
  }
  return {
    model: validation.value,
    schemaRegistry: registry
  };
}

module.exports = {
  DOMAIN_NAMES,
  caseHistory,
  reportModel,
  validatedReportModel
};
