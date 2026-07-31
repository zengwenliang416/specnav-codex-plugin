'use strict';

const path = require('node:path');

const { deepFreeze } = require('../contracts/schema-registry');
const { createEventSequence } = require('./event-sequence');
const {
  createRunningLifecycle,
  createTerminalLifecycle,
  terminalOutcome
} = require('./lifecycle');
const {
  blockedResult,
  executionBlocker,
  runPreflight,
  runPlaywrightPreflight,
  validateReferenceGraph,
  validateRunApproval,
  validateRuntime
} = require('./preflight');

function requireMethod(value, method, id) {
  if (!value || typeof value[method] !== 'function') {
    throw new Error(id);
  }
}

function requireProjectRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('verification-execution:project-root-required');
  }
  return path.resolve(value);
}

function commandSummary(commandResult) {
  return {
    exit_status: commandResult.exit_status,
    signal: commandResult.signal,
    timed_out: commandResult.timed_out,
    canceled: commandResult.canceled,
    spawn_error: commandResult.spawn_error
  };
}

function browserExecutionSummary(browserResult) {
  return {
    exit_status: browserResult.exit_status,
    signal: browserResult.signal,
    timed_out: browserResult.timed_out,
    canceled: browserResult.canceled,
    spawn_error: browserResult.spawn_error
  };
}

function browserOutcome(browserResult) {
  if (
    ['passed', 'failed', 'blocked', 'canceled'].includes(browserResult.status)
  ) {
    return {
      status: browserResult.status,
      blockers: Array.isArray(browserResult.blockers)
        ? browserResult.blockers
        : []
    };
  }
  if (browserResult.canceled) {
    return {
      status: 'canceled',
      blockers: [executionBlocker(
        'verification-execution:playwright-canceled',
        'playwright'
      )]
    };
  }
  if (browserResult.timed_out) {
    return {
      status: 'failed',
      blockers: [executionBlocker(
        'verification-execution:playwright-timeout',
        'playwright'
      )]
    };
  }
  if (browserResult.spawn_error) {
    return {
      status: 'blocked',
      blockers: [executionBlocker(
        'verification-execution:playwright-launch-failed',
        'playwright',
        browserResult.spawn_error
      )]
    };
  }
  return {
    status: 'blocked',
    blockers: [executionBlocker(
      'verification-execution:playwright-terminal-invalid',
      'playwright'
    )]
  };
}

function emitTerminalLifecycle(sequence, terminal) {
  sequence.emit('attempt.terminal', {
    attempt: terminal.attempt,
    artifact_valid: true
  });
  sequence.emit('run.terminal', {
    run: terminal.run,
    artifact_valid: true
  });
}

function emitUnavailableTerminalLifecycle(sequence) {
  sequence.emit('attempt.terminal', {
    attempt: null,
    status: 'blocked',
    artifact_valid: false
  });
  sequence.emit('run.terminal', {
    run: null,
    status: 'blocked',
    artifact_valid: false
  });
}

function blockedAfterExecution(options) {
  const {
    previousAttempts,
    running,
    terminal,
    commandResult,
    sequence,
    blockers
  } = options;
  emitTerminalLifecycle(sequence, terminal);
  sequence.emit('execution.contract-blocked', { blockers });
  return deepFreeze({
    ok: false,
    status: 'blocked',
    run: terminal.run,
    attempt: terminal.attempt,
    run_states: [running.run, terminal.run],
    attempt_states: [running.attempt, terminal.attempt],
    attempts: [...previousAttempts, terminal.attempt],
    command: commandSummary(commandResult),
    logs: {
      stdout: commandResult.stdout,
      stderr: commandResult.stderr
    },
    events: sequence.values(),
    blockers
  });
}

function terminalArtifactsUnavailable(options) {
  const {
    previousAttempts,
    running,
    commandResult,
    sequence,
    blockers
  } = options;
  emitUnavailableTerminalLifecycle(sequence);
  sequence.emit('execution.contract-blocked', { blockers });
  return deepFreeze({
    ok: false,
    status: 'blocked',
    run: null,
    attempt: null,
    run_states: [running.run],
    attempt_states: [running.attempt],
    attempts: [...previousAttempts],
    command: commandSummary(commandResult),
    logs: {
      stdout: commandResult.stdout,
      stderr: commandResult.stderr
    },
    events: sequence.values(),
    blockers
  });
}

function emitCommandEvent(sequence, input, testCase, event) {
  if (event.type === 'started') {
    sequence.emit('command.started', {
      command: {
        argv: [...input.command.argv],
        cwd: input.command.cwd,
        env_keys: Object.keys(input.command.env).sort(),
        timeout_ms: testCase.runner.timeout_ms
      }
    });
  } else if (event.type === 'stdout' || event.type === 'stderr') {
    sequence.emit(`command.${event.type}`, { chunk: event.chunk });
  } else if (event.type === 'terminal') {
    sequence.emit('command.terminal', {
      result: commandSummary(event.result)
    });
  }
}

function emitBrowserEvent(sequence, input, testCase, event) {
  if (!event || typeof event.type !== 'string') return;
  if (event.type === 'started') {
    sequence.emit('browser.started', {
      browser: {
        scenario_id: input.playwright.scenario_id,
        project: input.playwright.browser_project,
        timeout_ms: testCase.runner.timeout_ms
      }
    });
    return;
  }
  if (['console', 'network', 'assertion', 'artifact'].includes(event.type)) {
    sequence.emit(`browser.${event.type}`, {
      value: event.value || event.entry || event.artifact || event.assertion
    });
    return;
  }
  if (event.type === 'terminal') {
    sequence.emit('browser.terminal', {
      result: browserExecutionSummary(event.result)
    });
  }
}

function createExecutionOrchestrator(options = {}) {
  const dependencies = {
    approvalValidator: options.approvalValidator,
    schemaRegistry: options.schemaRegistry,
    commandAdapter: options.commandAdapter,
    playwrightAdapter: options.playwrightAdapter,
    crossReferenceValidator: options.crossReferenceValidator,
    projectRoot: requireProjectRoot(options.projectRoot),
    clock: options.clock || { now: () => new Date().toISOString() }
  };
  requireMethod(
    dependencies.approvalValidator,
    'assertExecutionApproved',
    'verification-execution:missing-approval-validator'
  );
  requireMethod(
    dependencies.schemaRegistry,
    'assertValid',
    'verification-execution:missing-schema-registry'
  );
  requireMethod(
    dependencies.commandAdapter,
    'validate',
    'verification-execution:missing-command-validator'
  );
  requireMethod(
    dependencies.commandAdapter,
    'execute',
    'verification-execution:missing-command-adapter'
  );
  requireMethod(
    dependencies.crossReferenceValidator,
    'validateCrossReferences',
    'verification-execution:missing-cross-reference-validator'
  );
  requireMethod(
    dependencies.clock,
    'now',
    'verification-execution:missing-clock'
  );

  async function executeCommand(input = {}) {
    const preflight = runPreflight(input, dependencies);
    if (!preflight.ok) return preflight.result;

    const runningResult = createRunningLifecycle({
      schemaRegistry: dependencies.schemaRegistry,
      run: preflight.run,
      testCase: preflight.testCase,
      attempt: input.attempt,
      startedAt: dependencies.clock.now()
    });
    if (!runningResult.value) {
      return blockedResult(
        preflight.previousAttempts,
        runningResult.blockers
      );
    }
    const running = runningResult.value;
    const graphProblems = validateReferenceGraph(
      dependencies.crossReferenceValidator,
      {
        run: preflight.run,
        snapshot: preflight.approvalResult.snapshot,
        attempts: [...preflight.previousAttempts, running.attempt]
      }
    );
    if (graphProblems) {
      return blockedResult(preflight.previousAttempts, graphProblems);
    }

    const sequence = createEventSequence({
      clock: dependencies.clock,
      onEvent: input.onEvent
    });
    sequence.emit('run.running', { run: running.run });
    sequence.emit('attempt.running', { attempt: running.attempt });

    let commandResult;
    try {
      commandResult = await dependencies.commandAdapter.execute(input.command, {
        timeoutMs: preflight.testCase.runner.timeout_ms,
        signal: input.signal,
        onEvent(event) {
          emitCommandEvent(sequence, input, preflight.testCase, event);
        }
      });
    } catch (error) {
      commandResult = {
        exit_status: null,
        signal: null,
        timed_out: false,
        canceled: false,
        spawn_error: error instanceof Error ? error.message : String(error),
        stdout: '',
        stderr: ''
      };
      sequence.emit('command.terminal', {
        result: commandSummary(commandResult)
      });
    }

    const outcome = terminalOutcome(commandResult);
    const completedAt = dependencies.clock.now();
    const terminalResult = createTerminalLifecycle({
      schemaRegistry: dependencies.schemaRegistry,
      running,
      outcome,
      commandResult,
      completedAt
    });
    if (!terminalResult.value) {
      const blockedTerminal = createTerminalLifecycle({
        schemaRegistry: dependencies.schemaRegistry,
        running,
        outcome: { status: 'blocked', blockers: [] },
        commandResult,
        completedAt
      });
      if (!blockedTerminal.value) {
        return terminalArtifactsUnavailable({
          previousAttempts: preflight.previousAttempts,
          running,
          commandResult,
          sequence,
          blockers: [
            ...outcome.blockers,
            ...terminalResult.blockers,
            ...blockedTerminal.blockers
          ]
        });
      }
      return blockedAfterExecution({
        previousAttempts: preflight.previousAttempts,
        running,
        terminal: blockedTerminal.value,
        commandResult,
        sequence,
        blockers: [
          ...outcome.blockers,
          ...terminalResult.blockers
        ]
      });
    }
    const terminal = terminalResult.value;
    emitTerminalLifecycle(sequence, terminal);

    return deepFreeze({
      ok: outcome.status === 'passed',
      status: outcome.status,
      run: terminal.run,
      attempt: terminal.attempt,
      run_states: [running.run, terminal.run],
      attempt_states: [running.attempt, terminal.attempt],
      attempts: [...preflight.previousAttempts, terminal.attempt],
      command: commandSummary(commandResult),
      logs: {
        stdout: commandResult.stdout,
        stderr: commandResult.stderr
      },
      events: sequence.values(),
      blockers: outcome.blockers
    });
  }

  async function executePlaywright(input = {}) {
    if (
      !dependencies.playwrightAdapter
      || typeof dependencies.playwrightAdapter.validate !== 'function'
      || typeof dependencies.playwrightAdapter.execute !== 'function'
    ) {
      return blockedResult(
        Array.isArray(input.previousAttempts) ? input.previousAttempts : [],
        [executionBlocker(
          'verification-execution:missing-playwright-adapter',
          'playwright-adapter'
        )]
      );
    }

    const preflight = runPlaywrightPreflight(input, dependencies);
    if (!preflight.ok) return preflight.result;

    const runningResult = createRunningLifecycle({
      schemaRegistry: dependencies.schemaRegistry,
      run: preflight.run,
      testCase: preflight.testCase,
      attempt: input.attempt,
      startedAt: dependencies.clock.now()
    });
    if (!runningResult.value) {
      return blockedResult(
        preflight.previousAttempts,
        runningResult.blockers
      );
    }
    const running = runningResult.value;
    const graphProblems = validateReferenceGraph(
      dependencies.crossReferenceValidator,
      {
        run: preflight.run,
        snapshot: preflight.approvalResult.snapshot,
        attempts: [...preflight.previousAttempts, running.attempt]
      }
    );
    if (graphProblems) {
      return blockedResult(preflight.previousAttempts, graphProblems);
    }

    const sequence = createEventSequence({
      clock: dependencies.clock,
      onEvent: input.onEvent
    });
    sequence.emit('run.running', { run: running.run });
    sequence.emit('attempt.running', { attempt: running.attempt });

    let browserResult;
    try {
      browserResult = await dependencies.playwrightAdapter.execute(
        input.playwright,
        {
          runtimeStatus: input.runtimeStatus,
          projectRoot: dependencies.projectRoot,
          timeoutMs: preflight.testCase.runner.timeout_ms,
          signal: input.signal,
          assertionContracts: preflight.testCase.assertions,
          expectedScenarioHash: preflight.testCase.runner.scenario_hash,
          allowedOrigins: preflight.testCase.runner.allowed_origins,
          onEvent(event) {
            emitBrowserEvent(sequence, input, preflight.testCase, event);
          }
        }
      );
    } catch (error) {
      const blocker = executionBlocker(
        'verification-execution:playwright-adapter-failed',
        'playwright-adapter',
        error instanceof Error ? error.message : String(error)
      );
      browserResult = {
        status: 'blocked',
        blockers: [
          blocker,
          ...(Array.isArray(error?.blockers) ? error.blockers : [])
        ],
        exit_status: null,
        signal: null,
        timed_out: false,
        canceled: false,
        spawn_error: blocker.detail,
        stdout: '',
        stderr: '',
        browser: null,
        assertions: [],
        artifacts: [],
        console: [],
        network: []
      };
      sequence.emit('browser.terminal', {
        result: browserExecutionSummary(browserResult)
      });
    }

    const outcome = browserOutcome(browserResult);
    const completedAt = dependencies.clock.now();
    const terminalResult = createTerminalLifecycle({
      schemaRegistry: dependencies.schemaRegistry,
      running,
      outcome,
      commandResult: browserResult,
      completedAt
    });
    const browserFields = {
      browser: browserResult.browser || null,
      assertions: Array.isArray(browserResult.assertions)
        ? browserResult.assertions
        : [],
      artifacts: Array.isArray(browserResult.artifacts)
        ? browserResult.artifacts
        : [],
      console: Array.isArray(browserResult.console)
        ? browserResult.console
        : [],
      network: Array.isArray(browserResult.network)
        ? browserResult.network
        : []
    };

    if (!terminalResult.value) {
      const blockedTerminal = createTerminalLifecycle({
        schemaRegistry: dependencies.schemaRegistry,
        running,
        outcome: { status: 'blocked', blockers: [] },
        commandResult: browserResult,
        completedAt
      });
      if (!blockedTerminal.value) {
        emitUnavailableTerminalLifecycle(sequence);
        const blockers = [
          ...outcome.blockers,
          ...terminalResult.blockers,
          ...blockedTerminal.blockers
        ];
        sequence.emit('execution.contract-blocked', { blockers });
        return deepFreeze({
          ok: false,
          status: 'blocked',
          run: null,
          attempt: null,
          run_states: [running.run],
          attempt_states: [running.attempt],
          attempts: [...preflight.previousAttempts],
          command: null,
          ...browserFields,
          logs: {
            stdout: browserResult.stdout || '',
            stderr: browserResult.stderr || ''
          },
          events: sequence.values(),
          blockers
        });
      }
      const terminal = blockedTerminal.value;
      emitTerminalLifecycle(sequence, terminal);
      const blockers = [...outcome.blockers, ...terminalResult.blockers];
      sequence.emit('execution.contract-blocked', { blockers });
      return deepFreeze({
        ok: false,
        status: 'blocked',
        run: terminal.run,
        attempt: terminal.attempt,
        run_states: [running.run, terminal.run],
        attempt_states: [running.attempt, terminal.attempt],
        attempts: [...preflight.previousAttempts, terminal.attempt],
        command: null,
        ...browserFields,
        logs: {
          stdout: browserResult.stdout || '',
          stderr: browserResult.stderr || ''
        },
        events: sequence.values(),
        blockers
      });
    }

    const terminal = terminalResult.value;
    emitTerminalLifecycle(sequence, terminal);
    return deepFreeze({
      ok: outcome.status === 'passed',
      status: outcome.status,
      run: terminal.run,
      attempt: terminal.attempt,
      run_states: [running.run, terminal.run],
      attempt_states: [running.attempt, terminal.attempt],
      attempts: [...preflight.previousAttempts, terminal.attempt],
      command: null,
      ...browserFields,
      logs: {
        stdout: browserResult.stdout || '',
        stderr: browserResult.stderr || ''
      },
      events: sequence.values(),
      blockers: outcome.blockers
    });
  }

  return Object.freeze({
    executeCommand,
    executePlaywright
  });
}

module.exports = {
  blockedAfterExecution,
  browserOutcome,
  createExecutionOrchestrator,
  executionBlocker,
  terminalOutcome,
  validateRunApproval,
  validateRuntime
};
