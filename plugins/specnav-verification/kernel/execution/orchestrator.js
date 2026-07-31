'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
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
  runMidscenePreflight,
  runPlaywrightPreflight,
  validateReferenceGraph,
  validateRunApproval,
  validateRuntime
} = require('./preflight');
const {
  evaluateMidsceneOracle,
  resolveMidsceneOracleMode
} = require('./midscene-oracle');

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

function midsceneExecutionSummary(result) {
  return {
    status: result.status,
    timed_out: result.timed_out === true,
    canceled: result.canceled === true,
    fallback_used: result.fallback_used === true
  };
}

function normalizeMidsceneInteraction(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    return structuredClone(value);
  } catch {
    return null;
  }
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateMidsceneScreenshot(interaction, request, projectRoot) {
  try {
    if (
      !Array.isArray(interaction.screenshots)
      || interaction.screenshots.length !== 1
    ) {
      throw new Error('screenshot count');
    }
    const screenshot = interaction.screenshots[0];
    if (
      !screenshot
      || screenshot.kind !== 'screenshot'
      || screenshot.producer !== 'midscene-runner'
      || typeof screenshot.path !== 'string'
      || typeof screenshot.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(screenshot.sha256)
      || !Number.isInteger(screenshot.size)
      || screenshot.size <= 0
    ) {
      throw new Error('screenshot metadata');
    }
    const canonicalProject = fs.realpathSync(projectRoot);
    const canonicalRoot = fs.realpathSync(request.artifact_root);
    const canonicalFile = fs.realpathSync(screenshot.path);
    const info = fs.lstatSync(canonicalFile);
    if (
      info.isSymbolicLink()
      || !info.isFile()
      || info.size !== screenshot.size
      || !isContained(canonicalProject, canonicalRoot)
      || !isContained(canonicalRoot, canonicalFile)
    ) {
      throw new Error('screenshot boundary');
    }
    const actualHash = crypto.createHash('sha256')
      .update(fs.readFileSync(canonicalFile))
      .digest('hex');
    if (actualHash !== screenshot.sha256) {
      throw new Error('screenshot hash');
    }
    return {
      screenshot: {
        ...screenshot,
        path: canonicalFile
      },
      blocker: null
    };
  } catch {
    return {
      screenshot: null,
      blocker: executionBlocker(
        'verification-execution:midscene-screenshot-invalid',
        'midscene'
      )
    };
  }
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
    midsceneAdapter: options.midsceneAdapter,
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

  async function executeMidscene(input = {}) {
    if (
      !dependencies.midsceneAdapter
      || typeof dependencies.midsceneAdapter.validate !== 'function'
      || typeof dependencies.midsceneAdapter.interact !== 'function'
    ) {
      return blockedResult(
        Array.isArray(input.previousAttempts) ? input.previousAttempts : [],
        [executionBlocker(
          'verification-execution:missing-midscene-adapter',
          'midscene-adapter'
        )]
      );
    }
    const preflight = runMidscenePreflight(input, dependencies);
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
    const oracleMode = resolveMidsceneOracleMode(preflight.testCase);
    if (oracleMode.blocker) {
      return blockedResult(
        preflight.previousAttempts,
        [oracleMode.blocker]
      );
    }
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
    sequence.emit('midscene.started', {
      scenario_id: input.midscene.scenario_id,
      prompt_id: input.midscene.prompt_id
    });

    let interaction;
    try {
      interaction = await dependencies.midsceneAdapter.interact(
        input.midscene,
        {
          runtimeStatus: input.runtimeStatus,
          projectRoot: dependencies.projectRoot,
          timeoutMs: preflight.testCase.runner.timeout_ms,
          signal: input.signal,
          allowedOrigins: preflight.testCase.runner.allowed_origins,
          expectedOracleScenarioHash:
            preflight.testCase.runner.oracle_scenario_hash,
          expectedPromptHash: preflight.testCase.runner.prompt_hash,
          expectedStartUrl: preflight.testCase.runner.start_url,
          oracleAssertionIds:
            preflight.testCase.runner.oracle_assertion_ids,
          oracleMode: oracleMode.mode,
          onEvent(event) {
            let type = 'unknown';
            try {
              if (typeof event?.type === 'string') type = event.type;
            } catch {
              type = 'invalid';
            }
            sequence.emit('midscene.progress', { type });
          }
        }
      );
    } catch (error) {
      interaction = {
        status: 'blocked',
        observation: null,
        prompt: null,
        model: null,
        screenshots: [],
        blockers: [executionBlocker(
          'verification-execution:midscene-adapter-failed',
          'midscene-adapter',
          null
        )],
        timed_out: false,
        canceled: false,
        fallback_used: false
      };
    }
    interaction = normalizeMidsceneInteraction(interaction) || {
      status: 'blocked',
      observation: null,
      prompt: null,
      model: null,
      screenshots: [],
      artifacts: [],
      assertions: [],
      blockers: [executionBlocker(
        'verification-execution:midscene-adapter-result-invalid',
        'midscene-adapter'
      )],
      timed_out: false,
      canceled: false,
      fallback_used: false
    };
    sequence.emit('midscene.terminal', {
      result: midsceneExecutionSummary(interaction)
    });

    let outcome;
    let oracleResult = {
      status: 'blocked',
      oracle: null,
      blockers: []
    };
    const screenshotValidation = validateMidsceneScreenshot(
      interaction,
      input.midscene,
      dependencies.projectRoot
    );
    if (
      interaction.status !== 'observed'
      || interaction.fallback_used !== false
      || screenshotValidation.blocker
    ) {
      const invalidScreenshot = (
        interaction.status === 'observed'
        && screenshotValidation.blocker
      );
      outcome = {
        status: interaction.canceled === true ? 'canceled' : 'blocked',
        blockers: invalidScreenshot
          ? [screenshotValidation.blocker]
          : (
            Array.isArray(interaction.blockers)
              ? interaction.blockers
              : [executionBlocker(
                'verification-execution:midscene-terminal-invalid',
                'midscene'
              )]
          )
      };
    } else {
      sequence.emit('midscene.observed', {
        observation: interaction.observation,
        screenshots: interaction.screenshots
      });
      let signoff = input.signoff || null;
      if (
        oracleMode.mode === 'human_signoff'
        && !signoff
        && typeof input.requestSignoff === 'function'
      ) {
        try {
          signoff = await input.requestSignoff(deepFreeze({
            schema: 'specnav.verification.midscene-signoff-request.v1',
            identity: {
              change_id: running.attempt.change_id,
              run_id: running.attempt.run_id,
              case_id: running.attempt.case_id,
              attempt_id: running.attempt.id,
              case_snapshot_hash: running.attempt.case_snapshot_hash
            },
            assertion_ids: [
              ...preflight.testCase.runner.oracle_assertion_ids
            ],
            screenshot: structuredClone(screenshotValidation.screenshot),
            observation: structuredClone(interaction.observation),
            prompt: structuredClone(interaction.prompt),
            model: structuredClone(interaction.model)
          }));
        } catch {
          signoff = null;
        }
      }
      const postSignoffScreenshot = validateMidsceneScreenshot(
        interaction,
        input.midscene,
        dependencies.projectRoot
      );
      if (postSignoffScreenshot.blocker) {
        oracleResult = {
          status: 'blocked',
          oracle: null,
          blockers: [postSignoffScreenshot.blocker]
        };
      } else {
        oracleResult = evaluateMidsceneOracle(
          preflight.testCase,
          {
            assertions: interaction.assertions,
            signoff,
            screenshot: postSignoffScreenshot.screenshot,
            identity: {
              change_id: running.attempt.change_id,
              run_id: running.attempt.run_id,
              case_id: running.attempt.case_id,
              attempt_id: running.attempt.id,
              case_snapshot_hash: running.attempt.case_snapshot_hash
            }
          },
          {
            expectedReviewerId: (
              preflight.approvalResult.approval?.reviewer?.id
              || input.approvalInput?.approval?.reviewer?.id
              || null
            )
          }
        );
      }
      sequence.emit('midscene.oracle', {
        status: oracleResult.status,
        oracle: oracleResult.oracle
      });
      outcome = {
        status: oracleResult.status,
        blockers: oracleResult.blockers
      };
    }

    const commandResult = {
      exit_status: outcome.status === 'passed'
        ? 0
        : outcome.status === 'failed'
          ? 1
          : null
    };
    const completedAt = dependencies.clock.now();
    const terminalResult = createTerminalLifecycle({
      schemaRegistry: dependencies.schemaRegistry,
      running,
      outcome,
      commandResult,
      completedAt
    });
    if (!terminalResult.value) {
      return terminalArtifactsUnavailable({
        previousAttempts: preflight.previousAttempts,
        running,
        commandResult: {
          ...commandResult,
          signal: null,
          timed_out: interaction.timed_out === true,
          canceled: interaction.canceled === true,
          spawn_error: null,
          stdout: '',
          stderr: ''
        },
        sequence,
        blockers: [...outcome.blockers, ...terminalResult.blockers]
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
      observation: interaction.observation || null,
      prompt: interaction.prompt || null,
      model: interaction.model || null,
      screenshots: Array.isArray(interaction.screenshots)
        ? interaction.screenshots
        : [],
      artifacts: Array.isArray(interaction.artifacts)
        ? interaction.artifacts
        : [],
      assertions: Array.isArray(interaction.assertions)
        ? interaction.assertions
        : [],
      console: Array.isArray(interaction.console)
        ? interaction.console
        : [],
      network: Array.isArray(interaction.network)
        ? interaction.network
        : [],
      oracle: oracleResult.oracle,
      logs: { stdout: '', stderr: '' },
      events: sequence.values(),
      blockers: outcome.blockers
    });
  }

  return Object.freeze({
    executeCommand,
    executeMidscene,
    executePlaywright
  });
}

module.exports = {
  blockedAfterExecution,
  browserOutcome,
  createExecutionOrchestrator,
  executionBlocker,
  midsceneExecutionSummary,
  terminalOutcome,
  validateRunApproval,
  validateRuntime
};
