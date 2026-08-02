'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const metadata = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/metadata'
));
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
const {
  doctorRuntime
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/doctor'
));
const {
  loadRuntimeLock
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/lock-manifest'
));
const {
  serializePlaywrightScenario
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/execution/playwright-scenario'
));
const {
  readySchemaRegistry,
  reviewer,
  sampleCase,
  sources
} = require('../cases/test-helpers');
const { monotonicClock } = require('../execution/test-helpers');

function managedRuntimeStatus() {
  const lock = loadRuntimeLock();
  return doctorRuntime({
    requestedVersion: lock.runtime_version,
    runtimeBase: path.join(
      os.homedir(),
      '.specnav/runtime/verification'
    ),
    lock,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      kernel: {
        name: metadata.name,
        version: metadata.version,
        apiVersion: metadata.apiVersion,
        contractVersion: metadata.contractVersion,
        contractDigest: metadata.contractDigest
      }
    },
    requiresMidscene: false
  });
}

function browserExecutionFixture(options = {}) {
  const projectRoot = fs.realpathSync(
    options.projectRoot || fs.mkdtempSync(
      path.join(os.tmpdir(), 'specnav-browser-project-')
    )
  );
  const schemaRegistry = readySchemaRegistry();
  const sourceArtifacts = sources();
  const approvedScenario = options.scenario || (async () => {});
  const serializedScenario = serializePlaywrightScenario(approvedScenario);
  assert.equal(
    serializedScenario.blocker,
    null,
    JSON.stringify(serializedScenario.blocker)
  );
  const allowedOrigins = options.allowedOrigins || ['https://example.invalid'];
  const testCase = sampleCase({
    id: 'case-playwright',
    assertions: [{
      id: 'assertion-1',
      statement: 'The browser scenario satisfies its deterministic assertion',
      expected: true,
      oracle: {
        type: 'playwright_assertion',
        human_signoff_allowed: false
      },
      evidence_kinds: ['assertion_result']
    }],
    runner: {
      kind: 'playwright',
      timeout_ms: options.timeoutMs || 120000,
      scenario_id: options.scenarioId || 'scenario-main',
      scenario_hash: serializedScenario.hash,
      browser_project: options.browserProject || 'chromium',
      allowed_origins: allowedOrigins,
      requires_midscene: false
    },
    evidence_policy: {
      allowed_kinds: [
        'screenshot',
        'video',
        'trace',
        'log',
        'assertion_result'
      ],
      required_kinds: [
        'screenshot',
        'video',
        'trace',
        'log',
        'assertion_result'
      ],
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
  const runtimeStatus = options.runtimeStatus || managedRuntimeStatus();
  const run = {
    schema: 'specnav.verification.run.v1',
    id: options.runId || 'run-playwright',
    change_id: snapshot.change_id,
    case_snapshot_id: snapshot.id,
    case_snapshot_hash: snapshot.snapshot_hash,
    case_ids: [testCase.id],
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(40),
    environment_hash: 'd'.repeat(64),
    runtime_version: runtimeStatus.runtime_version,
    kernel_version: metadata.version,
    status: 'planned',
    created_at: '2026-07-31T00:02:00Z',
    started_at: null,
    completed_at: null,
    kind: 'initial',
    origin_run_id: null,
    parent_run_id: null,
    parent_attempt_id: null,
    failure_id: null
  };

  function approveScenario(scenario, origins) {
    const serialized = serializePlaywrightScenario(scenario);
    assert.equal(serialized.blocker, null, JSON.stringify(serialized.blocker));
    const approvedCase = structuredClone(testCase);
    approvedCase.runner.scenario_hash = serialized.hash;
    approvedCase.runner.allowed_origins = [...origins];
    const approvedPlan = createCasePlanner({ schemaRegistry }).plan({
      changeId: 'verification-2-0',
      ...sourceArtifacts,
      cases: [approvedCase]
    });
    assert.equal(approvedPlan.ok, true, JSON.stringify(approvedPlan.blockers));
    const approvedSnapshotResult = createCaseSnapshotWriter({
      schemaRegistry
    }).create({
      plan: approvedPlan,
      createdAt: '2026-07-31T00:00:00Z',
      createdBy: reviewer()
    });
    assert.equal(
      approvedSnapshotResult.ok,
      true,
      JSON.stringify(approvedSnapshotResult.blockers)
    );
    const approvedSnapshot = approvedSnapshotResult.snapshot;
    return {
      approvalInput: {
        snapshot: approvedSnapshot,
        currentRequirements: sourceArtifacts.requirements,
        currentAcceptance: sourceArtifacts.acceptance,
        expectedReviewerId: 'reviewer-1',
        approval: {
          schema: 'specnav.verification.case-approval.v1',
          id: 'approval-playwright',
          change_id: approvedSnapshot.change_id,
          snapshot_id: approvedSnapshot.id,
          snapshot_hash: approvedSnapshot.snapshot_hash,
          decision: 'approved',
          reviewer: reviewer(),
          decided_at: '2026-07-31T00:01:00Z'
        }
      },
      run: {
        ...run,
        case_snapshot_id: approvedSnapshot.id,
        case_snapshot_hash: approvedSnapshot.snapshot_hash
      },
      attempt: {
        id: options.attemptId || 'attempt-playwright',
        kind: 'initial',
        sequence: 1,
        scenario_hash: serialized.hash,
        browser_project: approvedCase.runner.browser_project,
        test_data_snapshot: 'f'.repeat(64)
      },
      testCase: approvedCase,
      serialized
    };
  }

  return {
    schemaRegistry,
    approvalValidator: createCaseApprovalValidator({ schemaRegistry }),
    crossReferenceValidator: createCrossReferenceValidator({ schemaRegistry }),
    approvalInput: {
      snapshot,
      currentRequirements: sourceArtifacts.requirements,
      currentAcceptance: sourceArtifacts.acceptance,
      expectedReviewerId: 'reviewer-1',
      approval: {
        schema: 'specnav.verification.case-approval.v1',
        id: 'approval-playwright',
        change_id: snapshot.change_id,
        snapshot_id: snapshot.id,
        snapshot_hash: snapshot.snapshot_hash,
        decision: 'approved',
        reviewer: reviewer(),
        decided_at: '2026-07-31T00:01:00Z'
      }
    },
    runtimeStatus,
    run,
    caseId: testCase.id,
    attempt: {
      id: options.attemptId || 'attempt-playwright',
      kind: 'initial',
      sequence: 1,
      scenario_hash: serializedScenario.hash,
      browser_project: testCase.runner.browser_project,
      test_data_snapshot: 'f'.repeat(64)
    },
    testCase,
    approveScenario,
    projectRoot,
    artifactRoot: path.join(
      projectRoot,
      '.specnav',
      'verification-runs',
      run.id,
      options.attemptId || 'attempt-playwright'
    ),
    clock: monotonicClock(),
    cleanup() {
      if (!options.projectRoot) {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  };
}

function playwrightRequest(fixture, scenario, overrides = {}) {
  const {
    allowedOrigins = (
      typeof overrides.scenarioData?.baseUrl === 'string'
        ? [new URL(overrides.scenarioData.baseUrl).origin]
        : fixture.testCase.runner.allowed_origins
    ),
    scenarioData = null,
    ...requestOverrides
  } = overrides;
  const approved = fixture.approveScenario(scenario, allowedOrigins);
  return {
    approvalInput: approved.approvalInput,
    runtimeStatus: fixture.runtimeStatus,
    run: approved.run,
    caseId: fixture.caseId,
    attempt: approved.attempt,
    previousAttempts: [],
    playwright: {
      scenario_id: approved.testCase.runner.scenario_id,
      scenario_hash: approved.testCase.runner.scenario_hash,
      browser_project: approved.testCase.runner.browser_project,
      allowed_origins: [...approved.testCase.runner.allowed_origins],
      artifact_root: fixture.artifactRoot,
      scenario_data: scenarioData,
      scenario
    },
    ...requestOverrides
  };
}

module.exports = {
  ROOT,
  browserExecutionFixture,
  managedRuntimeStatus,
  playwrightRequest
};
