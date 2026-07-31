'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { deepFreeze } = require('../contracts/schema-registry');
const { validateApprovedCommand } = require('./command-contract');
const {
  createBrowserAccessPolicy
} = require('./browser-access-policy');
const {
  serializePlaywrightScenario
} = require('./playwright-scenario');
const {
  serializeMidscenePrompt
} = require('./midscene-prompt');

function executionBlocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function blockedResult(previousAttempts, blockers) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    run: null,
    attempt: null,
    run_states: [],
    attempt_states: [],
    attempts: structuredClone(previousAttempts),
    command: null,
    logs: { stdout: '', stderr: '' },
    events: [],
    blockers
  });
}

function validateArtifact(schemaRegistry, entityType, value) {
  try {
    return {
      value: schemaRegistry.assertValid(entityType, value),
      blockers: []
    };
  } catch (error) {
    return {
      value: null,
      blockers: [
        executionBlocker(
          `verification-execution:${entityType}-invalid`,
          entityType,
          error instanceof Error ? error.message : String(error)
        ),
        ...(Array.isArray(error?.blockers) ? error.blockers : [])
      ]
    };
  }
}

function validateRuntime(runtimeStatus, run) {
  if (
    runtimeStatus
    && runtimeStatus.ok === true
    && runtimeStatus.readiness === 'ready'
    && runtimeStatus.fallback_used === false
    && runtimeStatus.runtime_version === run.runtime_version
  ) {
    return null;
  }
  const detail = Array.isArray(runtimeStatus?.blockers)
    ? runtimeStatus.blockers.map((entry) => entry?.id).filter(Boolean).join(',')
    : '';
  return executionBlocker(
    'verification-execution:runtime-not-ready',
    'runtime-status',
    detail || null
  );
}

function validateRunApproval(run, approvalResult, caseId) {
  const snapshot = approvalResult.snapshot;
  const checks = [
    ['change_id', snapshot.change_id],
    ['case_snapshot_id', snapshot.id],
    ['case_snapshot_hash', snapshot.snapshot_hash]
  ];
  for (const [field, expected] of checks) {
    if (run[field] !== expected) {
      return executionBlocker(
        'verification-execution:run-approval-mismatch',
        run.id,
        field
      );
    }
  }
  if (!run.case_ids.includes(caseId)) {
    return executionBlocker(
      'verification-execution:run-approval-mismatch',
      run.id,
      'case_ids'
    );
  }
  return null;
}

function validateReferenceGraph(validator, values) {
  const result = validator.validateCrossReferences({
    activeChangeId: values.run.change_id,
    caseSnapshot: values.snapshot,
    run: values.run,
    attempts: values.attempts,
    readings: [],
    evidence: []
  });
  return result.ok ? null : result.blockers;
}

function initializePreflight(input, dependencies) {
  const previousAttempts = Array.isArray(input.previousAttempts)
    ? structuredClone(input.previousAttempts)
    : [];
  let approvalResult;
  try {
    approvalResult = dependencies.approvalValidator.assertExecutionApproved(
      input.approvalInput
    );
  } catch (error) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [
        executionBlocker(
          'verification-execution:approval-blocked',
          'case-approval',
          error instanceof Error ? error.message : String(error)
        ),
        ...(Array.isArray(error?.blockers) ? error.blockers : [])
      ])
    };
  }

  const runValidation = validateArtifact(
    dependencies.schemaRegistry,
    'verification-run',
    input.run
  );
  if (!runValidation.value) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, runValidation.blockers)
    };
  }
  const run = runValidation.value;
  const runtimeProblem = validateRuntime(input.runtimeStatus, run);
  if (runtimeProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [runtimeProblem])
    };
  }
  const testCase = approvalResult.snapshot.cases.find((entry) => (
    entry.id === input.caseId
  ));
  if (!testCase) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:approved-case-missing',
        'case-snapshot'
      )])
    };
  }
  return {
    ok: true,
    approvalResult,
    testCase,
    run,
    previousAttempts
  };
}

function completePreflight(base, dependencies, input) {
  const {
    approvalResult,
    testCase,
    run,
    previousAttempts
  } = base;
  const runProblem = validateRunApproval(run, approvalResult, input.caseId);
  if (runProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [runProblem])
    };
  }
  const graphProblems = validateReferenceGraph(
    dependencies.crossReferenceValidator,
    {
      run,
      snapshot: approvalResult.snapshot,
      attempts: previousAttempts
    }
  );
  if (graphProblems) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, graphProblems)
    };
  }
  return base;
}

function runPreflight(input, dependencies) {
  const base = initializePreflight(input, dependencies);
  if (!base.ok) return base;
  const {
    testCase,
    previousAttempts
  } = base;

  const commandValidation = dependencies.commandAdapter.validate(input.command);
  if (!commandValidation.ok) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, commandValidation.blockers)
    };
  }
  if (testCase.runner.kind !== 'command') {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:runner-kind-mismatch',
        testCase.id,
        testCase.runner.kind
      )])
    };
  }
  const commandProblem = validateApprovedCommand(
    testCase,
    input.command,
    dependencies.projectRoot
  );
  if (commandProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [commandProblem])
    };
  }
  return completePreflight(base, dependencies, input);
}

function nearestExistingAncestor(value) {
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  try {
    return fs.realpathSync(current);
  } catch {
    return null;
  }
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function validatePlaywrightRequest(testCase, request, attempt, projectRoot) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return executionBlocker(
      'verification-execution:playwright-request-invalid',
      testCase.id
    );
  }
  if (request.scenario_id !== testCase.runner.scenario_id) {
    return executionBlocker(
      'verification-execution:playwright-scenario-mismatch',
      testCase.id,
      request.scenario_id || null
    );
  }
  if (request.browser_project !== testCase.runner.browser_project) {
    return executionBlocker(
      'verification-execution:playwright-browser-project-mismatch',
      testCase.id,
      request.browser_project || null
    );
  }
  if (typeof request.scenario !== 'function') {
    return executionBlocker(
      'verification-execution:playwright-scenario-required',
      testCase.id
    );
  }
  const serialized = serializePlaywrightScenario(request.scenario);
  if (serialized.blocker) return serialized.blocker;
  if (serialized.hash !== testCase.runner.scenario_hash) {
    return executionBlocker(
      'verification-execution:playwright-scenario-hash-mismatch',
      testCase.id,
      serialized.hash
    );
  }
  if (request.scenario_hash !== testCase.runner.scenario_hash) {
    return executionBlocker(
      'verification-execution:playwright-scenario-hash-mismatch',
      testCase.id,
      request.scenario_hash || null
    );
  }
  if (attempt?.scenario_hash !== testCase.runner.scenario_hash) {
    return executionBlocker(
      'verification-execution:playwright-attempt-scenario-hash-mismatch',
      attempt?.id || testCase.id,
      attempt?.scenario_hash || null
    );
  }
  if (!sameStrings(request.allowed_origins, testCase.runner.allowed_origins)) {
    return executionBlocker(
      'verification-execution:playwright-allowed-origins-mismatch',
      testCase.id
    );
  }
  try {
    createBrowserAccessPolicy(request.allowed_origins);
  } catch {
    return executionBlocker(
      'verification-execution:playwright-allowed-origins-invalid',
      testCase.id
    );
  }
  if (
    typeof request.artifact_root !== 'string'
    || !path.isAbsolute(request.artifact_root)
  ) {
    return executionBlocker(
      'verification-execution:playwright-artifact-root-invalid',
      testCase.id
    );
  }
  const resolvedProject = path.resolve(projectRoot);
  const resolvedArtifact = path.resolve(request.artifact_root);
  if (
    resolvedArtifact === resolvedProject
    || !isContained(resolvedProject, resolvedArtifact)
  ) {
    return executionBlocker(
      'verification-execution:playwright-artifact-root-outside-project',
      testCase.id,
      resolvedArtifact
    );
  }
  let canonicalProject;
  try {
    canonicalProject = fs.realpathSync(resolvedProject);
  } catch {
    return executionBlocker(
      'verification-execution:playwright-project-root-unresolvable',
      testCase.id,
      resolvedProject
    );
  }
  const canonicalAncestor = nearestExistingAncestor(resolvedArtifact);
  if (!canonicalAncestor || !isContained(canonicalProject, canonicalAncestor)) {
    return executionBlocker(
      'verification-execution:playwright-artifact-root-outside-project',
      testCase.id,
      canonicalAncestor || resolvedArtifact
    );
  }
  return null;
}

function runPlaywrightPreflight(input, dependencies) {
  const base = initializePreflight(input, dependencies);
  if (!base.ok) return base;
  const {
    testCase,
    previousAttempts
  } = base;
  if (testCase.runner.kind !== 'playwright') {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:runner-kind-mismatch',
        testCase.id,
        testCase.runner.kind
      )])
    };
  }
  const requestProblem = validatePlaywrightRequest(
    testCase,
    input.playwright,
    input.attempt,
    dependencies.projectRoot
  );
  if (requestProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [requestProblem])
    };
  }
  const browserReady = input.runtimeStatus.checks?.browsers?.some((entry) => (
    entry.name === testCase.runner.browser_project
    && entry.executable_exists === true
    && entry.executable_allowed === true
    && entry.probe_ok === true
  ));
  if (!browserReady) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:playwright-browser-not-ready',
        testCase.runner.browser_project
      )])
    };
  }
  const adapterValidation = dependencies.playwrightAdapter.validate(
    input.playwright
  );
  if (!adapterValidation.ok) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, adapterValidation.blockers)
    };
  }
  return completePreflight(base, dependencies, input);
}

function validateMidsceneRequest(testCase, request, attempt, projectRoot) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return executionBlocker(
      'verification-execution:midscene-request-invalid',
      testCase.id
    );
  }
  for (const [field, expected] of [
    ['scenario_id', testCase.runner.scenario_id],
    ['scenario_hash', testCase.runner.scenario_hash],
    ['browser_project', testCase.runner.browser_project],
    ['prompt_id', testCase.runner.prompt_id],
    ['prompt_hash', testCase.runner.prompt_hash],
    ['start_url', testCase.runner.start_url],
    ['oracle_scenario_hash', testCase.runner.oracle_scenario_hash]
  ]) {
    if (request[field] !== expected) {
      return executionBlocker(
        `verification-execution:midscene-${field.replaceAll('_', '-')}-mismatch`,
        testCase.id,
        request[field] || null
      );
    }
  }
  const serializedPrompt = serializeMidscenePrompt(request.prompt);
  if (serializedPrompt.blocker) return serializedPrompt.blocker;
  if (serializedPrompt.hash !== testCase.runner.prompt_hash) {
    return executionBlocker(
      'verification-execution:midscene-prompt-hash-mismatch',
      testCase.id,
      serializedPrompt.hash
    );
  }
  const serializedOracle = serializePlaywrightScenario(
    request.oracle_scenario
  );
  if (serializedOracle.blocker) return executionBlocker(
    'verification-execution:midscene-oracle-scenario-invalid',
    testCase.id,
    serializedOracle.blocker.detail
  );
  if (serializedOracle.hash !== testCase.runner.oracle_scenario_hash) {
    return executionBlocker(
      'verification-execution:midscene-oracle-scenario-hash-mismatch',
      testCase.id,
      serializedOracle.hash
    );
  }
  if (attempt?.scenario_hash !== testCase.runner.scenario_hash) {
    return executionBlocker(
      'verification-execution:midscene-attempt-scenario-hash-mismatch',
      attempt?.id || testCase.id,
      attempt?.scenario_hash || null
    );
  }
  if (!sameStrings(request.allowed_origins, testCase.runner.allowed_origins)) {
    return executionBlocker(
      'verification-execution:midscene-allowed-origins-mismatch',
      testCase.id
    );
  }
  try {
    const policy = createBrowserAccessPolicy(request.allowed_origins);
    if (!policy.allows(request.start_url)) {
      return executionBlocker(
        'verification-execution:midscene-start-url-denied',
        testCase.id,
        policy.target(request.start_url)
      );
    }
  } catch {
    return executionBlocker(
      'verification-execution:midscene-allowed-origins-invalid',
      testCase.id
    );
  }
  if (
    typeof request.artifact_root !== 'string'
    || !path.isAbsolute(request.artifact_root)
  ) {
    return executionBlocker(
      'verification-execution:midscene-artifact-root-invalid',
      testCase.id
    );
  }
  const resolvedProject = path.resolve(projectRoot);
  const resolvedArtifact = path.resolve(request.artifact_root);
  if (
    resolvedArtifact === resolvedProject
    || !isContained(resolvedProject, resolvedArtifact)
  ) {
    return executionBlocker(
      'verification-execution:midscene-artifact-root-outside-project',
      testCase.id,
      resolvedArtifact
    );
  }
  let canonicalProject;
  try {
    canonicalProject = fs.realpathSync(resolvedProject);
  } catch {
    return executionBlocker(
      'verification-execution:midscene-project-root-unresolvable',
      testCase.id,
      resolvedProject
    );
  }
  const canonicalAncestor = nearestExistingAncestor(resolvedArtifact);
  if (!canonicalAncestor || !isContained(canonicalProject, canonicalAncestor)) {
    return executionBlocker(
      'verification-execution:midscene-artifact-root-outside-project',
      testCase.id,
      canonicalAncestor || resolvedArtifact
    );
  }
  return null;
}

function runMidscenePreflight(input, dependencies) {
  const base = initializePreflight(input, dependencies);
  if (!base.ok) return base;
  const {
    testCase,
    previousAttempts
  } = base;
  if (
    testCase.runner.kind !== 'midscene'
    || testCase.runner.requires_midscene !== true
  ) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:runner-kind-mismatch',
        testCase.id,
        testCase.runner.kind
      )])
    };
  }
  if (input.runtimeStatus.checks?.provider?.configured !== true) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:midscene-provider-not-configured',
        'environment'
      )])
    };
  }
  const browserReady = input.runtimeStatus.checks?.browsers?.some((entry) => (
    entry.name === testCase.runner.browser_project
    && entry.executable_exists === true
    && entry.executable_allowed === true
    && entry.probe_ok === true
  ));
  if (!browserReady) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:midscene-browser-not-ready',
        testCase.runner.browser_project
      )])
    };
  }
  const requestProblem = validateMidsceneRequest(
    testCase,
    input.midscene,
    input.attempt,
    dependencies.projectRoot
  );
  if (requestProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [requestProblem])
    };
  }
  let adapterValidation;
  try {
    adapterValidation = dependencies.midsceneAdapter.validate(input.midscene);
  } catch (error) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:midscene-adapter-validation-failed',
        'midscene-adapter',
        error instanceof Error ? error.message : String(error)
      )])
    };
  }
  if (
    !adapterValidation
    || typeof adapterValidation !== 'object'
    || !Array.isArray(adapterValidation.blockers)
  ) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:midscene-adapter-validation-invalid',
        'midscene-adapter'
      )])
    };
  }
  if (!adapterValidation.ok) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, adapterValidation.blockers)
    };
  }
  return completePreflight(base, dependencies, input);
}

module.exports = {
  blockedResult,
  completePreflight,
  executionBlocker,
  initializePreflight,
  runPreflight,
  runMidscenePreflight,
  runPlaywrightPreflight,
  validateArtifact,
  validateMidsceneRequest,
  validatePlaywrightRequest,
  validateReferenceGraph,
  validateRunApproval,
  validateRuntime
};
