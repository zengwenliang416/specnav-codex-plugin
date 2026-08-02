'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  managedRuntimeStatus
} = require('../browser/test-helpers');
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
const {
  providerConfigurationFingerprint
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/provider-contract'
));

const PROVIDER_ENV = Object.freeze({
  MIDSCENE_MODEL_NAME: 'model-a',
  MIDSCENE_MODEL_FAMILY: 'family-a',
  MIDSCENE_MODEL_BASE_URL: 'https://provider.invalid/v1',
  MIDSCENE_MODEL_API_KEY: 'secret-value'
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function providerReadyRuntimeStatus() {
  const runtimeStatus = structuredClone(managedRuntimeStatus());
  runtimeStatus.requires_midscene = true;
  runtimeStatus.checks.provider = {
    configured: true,
    model_name_present: true,
    model_family_present: true,
    credential_source: 'MIDSCENE_MODEL_API_KEY',
    base_url_present: true,
    configuration_fingerprint:
      providerConfigurationFingerprint(PROVIDER_ENV),
    secret_values_exposed: false
  };
  runtimeStatus.warnings = runtimeStatus.warnings.filter((entry) => (
    entry.id !== 'verification-runtime:midscene-provider-not-configured'
  ));
  return runtimeStatus;
}

function midsceneExecutionFixture(options = {}) {
  const projectRoot = fs.realpathSync(
    options.projectRoot || fs.mkdtempSync(
      path.join(os.tmpdir(), 'specnav-midscene-project-')
    )
  );
  const allowedOrigins = Array.isArray(options.allowedOrigins)
    ? [...options.allowedOrigins]
    : ['https://example.invalid'];
  const startUrl = options.startUrl || 'https://example.invalid/start';
  const runId = options.runId || 'run-midscene';
  const attemptId = options.attemptId || 'attempt-midscene';
  const schemaRegistry = readySchemaRegistry();
  const sourceArtifacts = sources();
  const prompt = options.prompt || 'Open the payroll summary.';
  const promptHash = sha256(prompt);
  const oracleScenario = options.oracleScenario || (async ({
    assertion,
    data
  }) => {
    assertion.ok('assertion-1', data.actual);
  });
  const serializedOracle = serializePlaywrightScenario(oracleScenario);
  assert.equal(serializedOracle.blocker, null);
  const oracleType = options.oracleType || 'structured_comparison';
  const testCase = sampleCase({
    id: 'case-midscene',
    assertions: [{
      id: 'assertion-1',
      statement: 'The approved UI fact is present',
      expected: true,
      oracle: {
        type: oracleType,
        human_signoff_allowed: options.humanSignoffAllowed === true
      },
      evidence_kinds: [
        oracleType === 'human_signoff'
          ? 'human_signoff'
          : 'structured_comparison'
      ]
    }],
    runner: {
      kind: 'midscene',
      timeout_ms: options.timeoutMs || 1000,
      scenario_id: 'scenario-midscene',
      scenario_hash: 'a'.repeat(64),
      browser_project: 'chromium',
      allowed_origins: allowedOrigins,
      prompt_id: 'prompt-midscene',
      prompt_hash: promptHash,
      start_url: startUrl,
      oracle_scenario_hash: serializedOracle.hash,
      oracle_assertion_ids: ['assertion-1'],
      requires_midscene: true
    },
    evidence_policy: {
      allowed_kinds: [
        'screenshot',
        'midscene_observation',
        oracleType === 'human_signoff'
          ? 'human_signoff'
          : 'structured_comparison'
      ],
      required_kinds: [
        'screenshot',
        'midscene_observation',
        oracleType === 'human_signoff'
          ? 'human_signoff'
          : 'structured_comparison'
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
  assert.equal(plan.ok, true, JSON.stringify(plan.blockers));
  const snapshotResult = createCaseSnapshotWriter({ schemaRegistry }).create({
    plan,
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  });
  assert.equal(snapshotResult.ok, true, JSON.stringify(snapshotResult.blockers));
  const snapshot = snapshotResult.snapshot;
  const runtimeStatus = options.runtimeStatus || providerReadyRuntimeStatus();
  const run = {
    schema: 'specnav.verification.run.v1',
    id: runId,
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
  const artifactRoot = options.artifactRoot || path.join(
    projectRoot,
    '.specnav',
    'verification-runs',
    run.id,
    attemptId
  );
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
        id: 'approval-midscene',
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
      id: attemptId,
      kind: 'initial',
      sequence: 1,
      scenario_hash: testCase.runner.scenario_hash,
      browser_project: testCase.runner.browser_project,
      test_data_snapshot: 'f'.repeat(64)
    },
    testCase,
    projectRoot,
    artifactRoot,
    prompt,
    promptHash,
    oracleScenario,
    serializedOracle,
    clock: monotonicClock(),
    cleanup() {
      if (!options.projectRoot) {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  };
}

function createOrchestrator(fixture, midsceneAdapter) {
  const { createExecutionOrchestrator } = require(
    `${ROOT}/plugins/specnav-verification/kernel/execution`
  );
  return createExecutionOrchestrator({
    approvalValidator: fixture.approvalValidator,
    schemaRegistry: fixture.schemaRegistry,
    commandAdapter: {
      validate() {
        return { ok: true, blockers: [] };
      },
      async execute() {
        throw new Error('command adapter must not execute');
      }
    },
    playwrightAdapter: {
      validate() {
        return { ok: true, blockers: [] };
      },
      async execute() {
        throw new Error('playwright adapter must not execute');
      }
    },
    midsceneAdapter,
    crossReferenceValidator: fixture.crossReferenceValidator,
    projectRoot: fixture.projectRoot,
    clock: fixture.clock
  });
}

function midsceneRequest(fixture, overrides = {}) {
  return {
    approvalInput: fixture.approvalInput,
    runtimeStatus: fixture.runtimeStatus,
    run: fixture.run,
    caseId: fixture.caseId,
    attempt: fixture.attempt,
    previousAttempts: [],
    midscene: {
      scenario_id: fixture.testCase.runner.scenario_id,
      scenario_hash: fixture.testCase.runner.scenario_hash,
      browser_project: fixture.testCase.runner.browser_project,
      allowed_origins: [...fixture.testCase.runner.allowed_origins],
      artifact_root: fixture.artifactRoot,
      prompt_id: fixture.testCase.runner.prompt_id,
      prompt_hash: fixture.promptHash,
      prompt: fixture.prompt,
      start_url: fixture.testCase.runner.start_url,
      oracle_scenario_hash: fixture.testCase.runner.oracle_scenario_hash,
      oracle_scenario: fixture.oracleScenario,
      scenario_data: {
        actual: true
      },
      interaction: {
        kind: 'act'
      }
    },
    ...overrides
  };
}

module.exports = {
  ROOT,
  createOrchestrator,
  midsceneExecutionFixture,
  midsceneRequest,
  PROVIDER_ENV,
  providerReadyRuntimeStatus,
  sha256
};
