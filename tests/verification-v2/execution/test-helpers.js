'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures/positive'
);

const {
  readySchemaRegistry,
  reviewer,
  sampleCase,
  sources
} = require('../cases/test-helpers');
const {
  createCaseApprovalValidator,
  createCasePlanner,
  createCaseSnapshotWriter
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/cases'
));
const {
  createCrossReferenceValidator
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/contracts/cross-reference-validator'
));

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));
}

function monotonicClock() {
  let tick = 0;
  return {
    now() {
      const value = new Date(Date.UTC(2026, 6, 31, 0, 0, 0, tick));
      tick += 1;
      return value.toISOString();
    }
  };
}

function executionFixture(options = {}) {
  const projectRoot = options.projectRoot || ROOT;
  const schemaRegistry = readySchemaRegistry();
  const sourceArtifacts = sources();
  const commandSpec = command(
    options.script || 'process.exit(0);',
    {
      cwd: options.cwd || projectRoot,
      env: options.env
    }
  );
  const testCase = sampleCase({
    id: 'case-command',
    runner: {
      kind: 'command',
      timeout_ms: options.timeoutMs || 1000,
      entrypoint: commandSpec.argv[0],
      args: commandSpec.argv.slice(1),
      cwd: path.relative(projectRoot, commandSpec.cwd) || '.',
      env_keys: Object.keys(commandSpec.env).sort(),
      requires_midscene: false
    },
    evidence_policy: {
      allowed_kinds: ['structured_comparison', 'log', 'command_output'],
      required_kinds: ['structured_comparison', 'log', 'command_output'],
      retain_on_failure: true,
      content_addressed: true
    }
  });
  const plan = createCasePlanner({ schemaRegistry }).plan({
    changeId: 'verification-2-0',
    ...sourceArtifacts,
    cases: [testCase]
  });
  const snapshotResult = createCaseSnapshotWriter({ schemaRegistry }).create({
    plan,
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  });
  assert.equal(snapshotResult.ok, true, JSON.stringify(snapshotResult.blockers));
  const snapshot = snapshotResult.snapshot;
  const approvalInput = {
    snapshot,
    currentRequirements: sourceArtifacts.requirements,
    currentAcceptance: sourceArtifacts.acceptance,
    expectedReviewerId: 'reviewer-1',
    approval: {
      schema: 'specnav.verification.case-approval.v1',
      id: 'approval-command',
      change_id: snapshot.change_id,
      snapshot_id: snapshot.id,
      snapshot_hash: snapshot.snapshot_hash,
      decision: 'approved',
      reviewer: reviewer(),
      decided_at: '2026-07-31T00:01:00Z'
    }
  };
  const run = {
    ...readFixture('verification-run.json'),
    id: options.runId || 'run-command',
    change_id: snapshot.change_id,
    case_snapshot_id: snapshot.id,
    case_snapshot_hash: snapshot.snapshot_hash,
    case_ids: [testCase.id],
    runtime_version: '1.0.0',
    kernel_version: '2.0.0',
    status: 'planned',
    created_at: '2026-07-31T00:02:00Z',
    started_at: null,
    completed_at: null
  };
  return {
    schemaRegistry,
    approvalValidator: createCaseApprovalValidator({ schemaRegistry }),
    crossReferenceValidator: createCrossReferenceValidator({
      schemaRegistry
    }),
    approvalInput,
    runtimeStatus: readFixture('runtime-status.json'),
    run,
    caseId: testCase.id,
    attempt: {
      id: options.attemptId || 'attempt-command',
      kind: options.kind || 'initial',
      sequence: options.sequence || 1,
      scenario_hash: 'e'.repeat(64),
      browser_project: 'none',
      test_data_snapshot: 'f'.repeat(64),
      ...(options.parentAttemptId
        ? { parent_attempt_id: options.parentAttemptId }
        : {})
    },
    command: commandSpec,
    projectRoot,
    clock: monotonicClock()
  };
}

function command(script, options = {}) {
  return {
    argv: [process.execPath, '-e', script],
    cwd: options.cwd || ROOT,
    env: {
      PATH: process.env.PATH || '',
      ...(options.env || {})
    }
  };
}

module.exports = {
  ROOT,
  command,
  executionFixture,
  monotonicClock
};
