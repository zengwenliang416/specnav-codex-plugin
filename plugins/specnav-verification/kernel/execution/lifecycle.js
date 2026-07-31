'use strict';

const { executionBlocker, validateArtifact } = require('./preflight');

function createRunningLifecycle(options) {
  const {
    schemaRegistry,
    run,
    testCase,
    attempt,
    startedAt,
    runnerKind = testCase.runner.kind,
    browserProject = (
      testCase.runner.kind === 'command'
        ? 'none'
        : testCase.runner.browser_project
    )
  } = options;
  const runningRun = validateArtifact(schemaRegistry, 'verification-run', {
    ...run,
    status: 'running',
    started_at: startedAt,
    completed_at: null
  });
  if (!runningRun.value) return runningRun;

  const candidate = {
    schema: 'specnav.verification.attempt.v1',
    id: attempt?.id,
    run_id: run.id,
    change_id: run.change_id,
    case_id: testCase.id,
    case_snapshot_hash: run.case_snapshot_hash,
    kind: attempt?.kind,
    sequence: attempt?.sequence,
    runner: runnerKind,
    code_sha: run.code_sha,
    test_sha: run.test_sha,
    scenario_hash: attempt?.scenario_hash,
    environment_hash: run.environment_hash,
    browser_project: browserProject,
    test_data_snapshot: attempt?.test_data_snapshot,
    runtime_version: run.runtime_version,
    kernel_version: run.kernel_version,
    status: 'running',
    started_at: startedAt,
    completed_at: null,
    exit_status: null,
    ...(attempt?.parent_attempt_id
      ? { parent_attempt_id: attempt.parent_attempt_id }
      : {})
  };
  const runningAttempt = validateArtifact(
    schemaRegistry,
    'attempt',
    candidate
  );
  if (!runningAttempt.value) return runningAttempt;
  return {
    value: {
      run: runningRun.value,
      attempt: runningAttempt.value
    },
    blockers: []
  };
}

function terminalOutcome(commandResult) {
  if (commandResult.canceled) {
    return {
      status: 'canceled',
      blockers: [executionBlocker(
        'verification-execution:command-canceled',
        'command'
      )]
    };
  }
  if (commandResult.timed_out) {
    return {
      status: 'failed',
      blockers: [executionBlocker(
        'verification-execution:command-timeout',
        'command'
      )]
    };
  }
  if (commandResult.spawn_error) {
    return {
      status: 'blocked',
      blockers: [executionBlocker(
        'verification-execution:command-spawn-failed',
        'command',
        commandResult.spawn_error
      )]
    };
  }
  if (commandResult.signal) {
    return {
      status: 'failed',
      blockers: [executionBlocker(
        'verification-execution:command-signaled',
        'command',
        commandResult.signal
      )]
    };
  }
  if (commandResult.exit_status === 0) {
    return { status: 'passed', blockers: [] };
  }
  return {
    status: 'failed',
    blockers: [executionBlocker(
      'verification-execution:command-exit-nonzero',
      'command',
      String(commandResult.exit_status)
    )]
  };
}

function createTerminalLifecycle(options) {
  const {
    schemaRegistry,
    running,
    outcome,
    commandResult,
    completedAt
  } = options;
  const attempt = validateArtifact(schemaRegistry, 'attempt', {
    ...running.attempt,
    status: outcome.status,
    completed_at: completedAt,
    exit_status: commandResult.exit_status
  });
  if (!attempt.value) return attempt;
  const run = validateArtifact(schemaRegistry, 'verification-run', {
    ...running.run,
    status: outcome.status,
    completed_at: completedAt
  });
  if (!run.value) return run;
  return {
    value: {
      run: run.value,
      attempt: attempt.value
    },
    blockers: []
  };
}

module.exports = {
  createRunningLifecycle,
  createTerminalLifecycle,
  terminalOutcome
};
