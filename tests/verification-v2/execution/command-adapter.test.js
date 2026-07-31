'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  ROOT,
  command,
  executionFixture
} = require('./test-helpers');

const COMMAND_ADAPTER = `${ROOT}/plugins/specnav-verification/kernel/adapters/command-adapter.js`;
const EXECUTION = `${ROOT}/plugins/specnav-verification/kernel/execution`;

function requireExecution() {
  return require(EXECUTION);
}

function requireCommandAdapter() {
  return require(COMMAND_ADAPTER);
}

function createOrchestrator(fixture, adapter) {
  const { createExecutionOrchestrator } = requireExecution();
  return createExecutionOrchestrator({
    approvalValidator: fixture.approvalValidator,
    schemaRegistry: fixture.schemaRegistry,
    commandAdapter: adapter,
    crossReferenceValidator: fixture.crossReferenceValidator,
    projectRoot: fixture.projectRoot,
    clock: fixture.clock
  });
}

function request(fixture, commandSpec, overrides = {}) {
  return {
    approvalInput: fixture.approvalInput,
    runtimeStatus: fixture.runtimeStatus,
    run: fixture.run,
    caseId: fixture.caseId,
    attempt: fixture.attempt,
    command: commandSpec,
    previousAttempts: [],
    ...overrides
  };
}

test('command adapter passes explicit argv, cwd, and env without a shell fallback', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const calls = [];
  const adapterEvents = [];
  const spawn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.emit('spawn');
      child.stdout.write('  stdout stays raw\n');
      child.stderr.write('\tstderr stays raw\n');
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0, null);
    });
    return child;
  };
  const adapter = createCommandAdapter({ spawn });
  const input = {
    argv: ['/fixture/node', 'script.js', '$(must-not-expand)'],
    cwd: '/fixture/worktree',
    env: {
      PATH: '/fixture/bin',
      SPECNAV_VALUE: 'literal'
    }
  };
  const before = structuredClone(input);
  const result = await adapter.execute(input, {
    timeoutMs: 500,
    onEvent(event) {
      adapterEvents.push(event);
    }
  });

  assert.deepEqual(calls, [{
    file: '/fixture/node',
    args: ['script.js', '$(must-not-expand)'],
    options: {
      cwd: '/fixture/worktree',
      env: {
        PATH: '/fixture/bin',
        SPECNAV_VALUE: 'literal'
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  }]);
  assert.equal(result.stdout, '  stdout stays raw\n');
  assert.equal(result.stderr, '\tstderr stays raw\n');
  assert.equal(result.exit_status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timed_out, false);
  assert.equal(result.canceled, false);
  assert.deepEqual(
    adapterEvents.map((event) => event.type),
    ['started', 'stdout', 'stderr', 'terminal']
  );
  assert.deepEqual(input, before);
});

test('orchestrator blocks before spawn unless Task 005 approval succeeds', async () => {
  const fixture = executionFixture();
  const expectedBlocker = {
    id: 'verification-cases:approval-rejected',
    artifact: 'case-approval',
    field: '/decision'
  };
  fixture.approvalValidator = {
    assertExecutionApproved() {
      const error = new Error('verification-cases:execution-blocked');
      error.blockers = [expectedBlocker];
      throw error;
    }
  };
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      throw new Error('must not execute');
    }
  });

  const result = await orchestrator.executeCommand(request(
    fixture,
    command('process.exit(0)')
  ));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(executeCalls, 0);
  assert.deepEqual(result.attempt_states, []);
  assert.equal(
    result.blockers[0].id,
    'verification-execution:approval-blocked'
  );
  assert.deepEqual(result.blockers.slice(1), [expectedBlocker]);
});

test('orchestrator blocks before spawn unless runtime doctor is ready', async () => {
  const fixture = executionFixture();
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      throw new Error('must not execute');
    }
  });
  const blockedRuntime = {
    ...fixture.runtimeStatus,
    ok: false,
    readiness: 'blocked',
    blockers: [{
      id: 'verification-runtime:runtime-missing',
      artifact: '/fixture/runtime',
      detail: null
    }]
  };

  const result = await orchestrator.executeCommand(request(
    fixture,
    command('process.exit(0)'),
    { runtimeStatus: blockedRuntime }
  ));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(executeCalls, 0);
  assert.deepEqual(result.attempt_states, []);
  assert.deepEqual(result.blockers, [{
    id: 'verification-execution:runtime-not-ready',
    artifact: 'runtime-status',
    detail: 'verification-runtime:runtime-missing'
  }]);
});

test('orchestrator rejects a run that is not bound to the approved snapshot', async () => {
  const fixture = executionFixture();
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      throw new Error('must not execute');
    }
  });
  const mismatchedRun = {
    ...fixture.run,
    case_snapshot_hash: '0'.repeat(64)
  };

  const result = await orchestrator.executeCommand(request(
    fixture,
    fixture.command,
    { run: mismatchedRun }
  ));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(executeCalls, 0);
  assert.deepEqual(result.attempt_states, []);
  assert.deepEqual(result.blockers, [{
    id: 'verification-execution:run-approval-mismatch',
    artifact: fixture.run.id,
    detail: 'case_snapshot_hash'
  }]);
});

test('successful command emits structured run and attempt states with raw logs', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const script = (
    'process.stdout.write(`  out:${process.env.SPECNAV_VALUE}\\n`);'
      + 'process.stderr.write(`err  \\n`);'
  );
  const fixture = executionFixture({
    script,
    env: { SPECNAV_VALUE: 'explicit-env' }
  });
  const orchestrator = createOrchestrator(fixture, createCommandAdapter());
  const input = request(fixture, fixture.command);
  const before = structuredClone(input);
  const observedEvents = [];

  const result = await orchestrator.executeCommand({
    ...input,
    onEvent(event) {
      observedEvents.push(event);
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'passed');
  assert.equal(result.logs.stdout, '  out:explicit-env\n');
  assert.equal(result.logs.stderr, 'err  \n');
  assert.deepEqual(
    result.run_states.map((run) => run.status),
    ['running', 'passed']
  );
  assert.deepEqual(
    result.attempt_states.map((attempt) => attempt.status),
    ['running', 'passed']
  );
  assert.equal(result.attempt.exit_status, 0);
  assert.equal(result.attempt.runner, 'command');
  assert.equal(result.attempt.case_id, fixture.caseId);
  assert.equal(result.attempt.run_id, fixture.run.id);
  assert.equal(result.attempt.code_sha, fixture.run.code_sha);
  assert.equal(result.attempt.test_sha, fixture.run.test_sha);
  assert.equal(result.attempt.scenario_hash, fixture.attempt.scenario_hash);
  assert.equal(result.attempt.environment_hash, fixture.run.environment_hash);
  assert.equal(result.attempt.browser_project, 'none');
  assert.equal(
    result.attempt.test_data_snapshot,
    fixture.attempt.test_data_snapshot
  );
  assert.deepEqual(
    observedEvents.map((event) => event.type),
    [
      'run.running',
      'attempt.running',
      'command.started',
      'command.stdout',
      'command.stderr',
      'command.terminal',
      'attempt.terminal',
      'run.terminal'
    ]
  );
  assert.deepEqual(
    observedEvents.map((event) => event.sequence),
    observedEvents.map((_, index) => index + 1)
  );
  assert.deepEqual(input, before);
});

test('timeout escalates to SIGKILL when the child ignores SIGTERM', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const killSignals = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      killSignals.push(signal);
      if (signal === 'SIGKILL') {
        queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
      }
      return true;
    };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const adapter = createCommandAdapter({
    spawn,
    killGraceMs: 10
  });

  const result = await Promise.race([
    adapter.execute({
      argv: ['/fixture/ignores-term'],
      cwd: '/fixture',
      env: {}
    }, {
      timeoutMs: 10
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('adapter timeout was not bounded')), 200);
    })
  ]);

  assert.deepEqual(killSignals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.timed_out, true);
  assert.equal(result.signal, 'SIGKILL');
});

test('exit before close cannot be reclassified by late cancellation or timeout', async (t) => {
  const { createCommandAdapter } = requireCommandAdapter();

  await t.test('late cancellation', async () => {
    const controller = new AbortController();
    const killSignals = [];
    const spawn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        killSignals.push(signal);
        return true;
      };
      queueMicrotask(() => {
        child.emit('spawn');
        child.emit('exit', 0, null);
        setTimeout(() => controller.abort(), 5);
        setTimeout(() => child.emit('close', 0, null), 20);
      });
      return child;
    };
    const result = await createCommandAdapter({ spawn }).execute({
      argv: ['/fixture/exits-before-close'],
      cwd: '/fixture',
      env: {}
    }, {
      signal: controller.signal,
      timeoutMs: 100
    });

    assert.equal(result.exit_status, 0);
    assert.equal(result.canceled, false);
    assert.equal(result.timed_out, false);
    assert.deepEqual(killSignals, []);
  });

  await t.test('late timeout', async () => {
    const killSignals = [];
    const spawn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        killSignals.push(signal);
        return true;
      };
      queueMicrotask(() => {
        child.emit('spawn');
        child.emit('exit', 0, null);
        setTimeout(() => child.emit('close', 0, null), 25);
      });
      return child;
    };
    const result = await createCommandAdapter({ spawn }).execute({
      argv: ['/fixture/exits-before-timeout'],
      cwd: '/fixture',
      env: {}
    }, {
      timeoutMs: 10
    });

    assert.equal(result.exit_status, 0);
    assert.equal(result.canceled, false);
    assert.equal(result.timed_out, false);
    assert.deepEqual(killSignals, []);
  });
});

test('timeout remains the terminal cause when abort arrives before close', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const fixture = executionFixture({
    timeoutMs: 10,
    attemptId: 'attempt-timeout-before-abort'
  });
  const controller = new AbortController();
  const killSignals = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      killSignals.push(signal);
      if (killSignals.length === 1) {
        queueMicrotask(() => controller.abort());
        setTimeout(() => child.emit('close', null, signal), 20);
      }
      return true;
    };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };

  const result = await createOrchestrator(
    fixture,
    createCommandAdapter({ spawn })
  ).executeCommand(request(
    fixture,
    fixture.command,
    { signal: controller.signal }
  ));

  assert.deepEqual(killSignals, ['SIGTERM']);
  assert.equal(result.status, 'failed');
  assert.equal(result.attempt.status, 'failed');
  assert.equal(result.command.timed_out, true);
  assert.equal(result.command.canceled, false);
  assert.equal(
    result.blockers[0].id,
    'verification-execution:command-timeout'
  );
});

test('empty argv is a stable blocker and never starts an attempt', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const fixture = executionFixture();
  const orchestrator = createOrchestrator(fixture, createCommandAdapter());

  const result = await orchestrator.executeCommand(request(fixture, {
    argv: [],
    cwd: ROOT,
    env: {}
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.attempt_states, []);
  assert.deepEqual(result.blockers, [{
    id: 'verification-execution:command-argv-invalid',
    artifact: 'command',
    detail: 'argv must contain at least one non-empty string'
  }]);
});

test('approved command binds argv, project-relative cwd, and env keys', async (t) => {
  const { createCommandAdapter } = requireCommandAdapter();
  const fixture = executionFixture({
    script: 'process.stdout.write(process.env.SPECNAV_VALUE);',
    env: { SPECNAV_VALUE: 'approved' }
  });
  const orchestrator = createOrchestrator(fixture, createCommandAdapter());
  const cases = [
    {
      name: 'argv mismatch',
      command: {
        ...fixture.command,
        argv: [...fixture.command.argv, '--unapproved']
      },
      blocker: 'verification-execution:command-argv-mismatch'
    },
    {
      name: 'cwd mismatch',
      command: {
        ...fixture.command,
        cwd: path.dirname(ROOT)
      },
      blocker: 'verification-execution:command-cwd-mismatch'
    },
    {
      name: 'env key mismatch',
      command: {
        ...fixture.command,
        env: {
          ...fixture.command.env,
          UNAPPROVED_KEY: 'value'
        }
      },
      blocker: 'verification-execution:command-env-keys-mismatch'
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const result = await orchestrator.executeCommand(request(
        fixture,
        entry.command
      ));
      assert.equal(result.ok, false);
      assert.equal(result.status, 'blocked');
      assert.deepEqual(result.attempt_states, []);
      assert.equal(result.blockers[0].id, entry.blocker);
    });
  }
});

test('approved cwd cannot escape project root through a directory symlink', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-project-'));
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-external-'));
  const escape = path.join(projectRoot, 'escape');
  fs.symlinkSync(externalRoot, escape, 'dir');

  try {
    const fixture = executionFixture({
      projectRoot,
      cwd: escape
    });
    const result = await createOrchestrator(
      fixture,
      createCommandAdapter()
    ).executeCommand(request(
      fixture,
      fixture.command
    ));

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.attempt_states, []);
    assert.equal(
      result.blockers[0].id,
      'verification-execution:command-cwd-outside-project'
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('approved cwd must resolve before an attempt can start', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-project-'));
  const missingCwd = path.join(projectRoot, 'missing');
  const fixture = executionFixture({
    projectRoot,
    cwd: missingCwd
  });
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      throw new Error('must not execute');
    }
  });

  try {
    const result = await orchestrator.executeCommand(request(
      fixture,
      fixture.command
    ));

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(executeCalls, 0);
    assert.deepEqual(result.attempt_states, []);
    assert.equal(
      result.blockers[0].id,
      'verification-execution:command-cwd-unresolvable'
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('command case schema requires the complete approved command contract', () => {
  const { readySchemaRegistry, sampleCase } = require('../cases/test-helpers');
  const schemaRegistry = readySchemaRegistry();
  const incomplete = sampleCase({
    runner: {
      kind: 'command',
      timeout_ms: 1000,
      entrypoint: process.execPath,
      requires_midscene: false
    }
  });
  const result = schemaRegistry.validate('test-case', incomplete);

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      ['/runner/args', '/runner/cwd', '/runner/env_keys'].includes(entry.field)
    )),
    true,
    JSON.stringify(result.blockers)
  );
});

test('kernel public entry exports command execution factories', () => {
  const kernel = require(`${ROOT}/plugins/specnav-verification`);

  assert.equal(typeof kernel.createCommandAdapter, 'function');
  assert.equal(typeof kernel.createExecutionOrchestrator, 'function');
});

test('nonzero, signal, timeout, and cancellation produce terminal attempts', async (t) => {
  const { createCommandAdapter } = requireCommandAdapter();
  const cases = [
    {
      name: 'nonzero exit',
      script: (
        'process.stdout.write("failed-out\\n");'
          + 'process.stderr.write("failed-err\\n");'
          + 'process.exit(7);'
      ),
      expected: {
        status: 'failed',
        exit_status: 7,
        signal: null,
        timed_out: false,
        canceled: false,
        blocker: 'verification-execution:command-exit-nonzero'
      }
    },
    {
      name: 'process signal',
      script: 'process.kill(process.pid, "SIGTERM");',
      expected: {
        status: 'failed',
        exit_status: null,
        signal: 'SIGTERM',
        timed_out: false,
        canceled: false,
        blocker: 'verification-execution:command-signaled'
      }
    },
    {
      name: 'timeout',
      fixtureOptions: { timeoutMs: 50 },
      script: 'setTimeout(() => {}, 5000);',
      expected: {
        status: 'failed',
        exit_status: null,
        signal: 'SIGTERM',
        timed_out: true,
        canceled: false,
        blocker: 'verification-execution:command-timeout'
      }
    },
    {
      name: 'cancellation',
      script: 'setTimeout(() => {}, 5000);',
      cancel: true,
      expected: {
        status: 'canceled',
        exit_status: null,
        signal: 'SIGTERM',
        timed_out: false,
        canceled: true,
        blocker: 'verification-execution:command-canceled'
      }
    }
  ];

  for (const [index, entry] of cases.entries()) {
    await t.test(entry.name, async () => {
      const fixture = executionFixture({
        ...(entry.fixtureOptions || {}),
        script: entry.script,
        attemptId: `attempt-outcome-${index + 1}`
      });
      const orchestrator = createOrchestrator(fixture, createCommandAdapter());
      const controller = entry.cancel ? new AbortController() : null;
      if (controller) {
        setTimeout(() => controller.abort(), 50);
      }
      const result = await orchestrator.executeCommand(request(
        fixture,
        fixture.command,
        controller ? { signal: controller.signal } : {}
      ));

      assert.equal(result.status, entry.expected.status);
      assert.equal(result.attempt.status, entry.expected.status);
      assert.equal(result.attempt.exit_status, entry.expected.exit_status);
      assert.equal(result.command.signal, entry.expected.signal);
      assert.equal(result.command.timed_out, entry.expected.timed_out);
      assert.equal(result.command.canceled, entry.expected.canceled);
      assert.equal(result.blockers[0].id, entry.expected.blocker);
      assert.equal(
        result.events.at(-1).type,
        'run.terminal'
      );
    });
  }
});

test('a later passing attempt retains the earlier failed attempt unchanged', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-command-retry-'));
  const marker = path.join(sandbox, 'marker');
  const script = [
    'const fs = require("node:fs");',
    `const marker = ${JSON.stringify(marker)};`,
    'if (!fs.existsSync(marker)) {',
    '  fs.writeFileSync(marker, "failed-once");',
    '  process.stderr.write("first failure\\n");',
    '  process.exit(2);',
    '}',
    'process.stdout.write("retry passed\\n");'
  ].join('\n');
  const firstFixture = executionFixture({
    runId: 'run-history',
    attemptId: 'attempt-failed',
    script
  });
  const firstOrchestrator = createOrchestrator(
    firstFixture,
    createCommandAdapter()
  );
  const failed = await firstOrchestrator.executeCommand(request(
    firstFixture,
    firstFixture.command
  ));
  const retainedFailure = structuredClone(failed.attempt);

  const retryFixture = executionFixture({
    runId: 'run-history',
    attemptId: 'attempt-retry',
    kind: 'retry',
    sequence: 2,
    parentAttemptId: 'attempt-failed',
    script
  });
  const retryOrchestrator = createOrchestrator(
    retryFixture,
    createCommandAdapter()
  );
  const previousAttempts = [structuredClone(failed.attempt)];
  const before = structuredClone(previousAttempts);
  assert.equal(Object.isFrozen(previousAttempts[0]), false);
  const passed = await retryOrchestrator.executeCommand(request(
    retryFixture,
    retryFixture.command,
    { previousAttempts }
  ));

  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.attempts.map((attempt) => attempt.id), [
    'attempt-failed',
    'attempt-retry'
  ]);
  assert.deepEqual(passed.attempts[0], retainedFailure);
  assert.equal(passed.attempts[0].status, 'failed');
  assert.equal(passed.attempts[1].status, 'passed');
  assert.deepEqual(previousAttempts, before);
  assert.equal(Object.isFrozen(previousAttempts[0]), false);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('retry identity is validated before command execution', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const initialFixture = executionFixture({
    runId: 'run-retry-invalid',
    attemptId: 'attempt-parent'
  });
  const initial = await createOrchestrator(
    initialFixture,
    createCommandAdapter()
  ).executeCommand(request(
    initialFixture,
    initialFixture.command
  ));
  assert.equal(initial.ok, true, JSON.stringify(initial.blockers));

  const fixture = executionFixture({
    runId: 'run-retry-invalid',
    attemptId: 'attempt-retry-invalid',
    kind: 'retry',
    sequence: 2,
    parentAttemptId: 'attempt-parent'
  });
  fixture.attempt.scenario_hash = 'a'.repeat(64);
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      return {
        exit_status: 0,
        signal: null,
        timed_out: false,
        canceled: false,
        spawn_error: null,
        stdout: '',
        stderr: ''
      };
    }
  });
  const result = await orchestrator.executeCommand(request(
    fixture,
    fixture.command,
    { previousAttempts: [initial.attempt] }
  ));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(executeCalls, 0);
  assert.deepEqual(result.attempt_states, []);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-contract:retry-fingerprint-mismatch'
    )),
    true,
    JSON.stringify(result.blockers)
  );
});

test('post-execution contract failure preserves raw logs and command events', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const { createExecutionOrchestrator } = requireExecution();
  const fixture = executionFixture({
    script: 'process.stdout.write("retained-out\\n");'
  });
  const schemaRegistry = {
    assertValid(entityType, value) {
      if (entityType === 'attempt' && value.status === 'passed') {
        const error = new Error('terminal attempt rejected');
        error.blockers = [{
          id: 'verification-contract:terminal-attempt-rejected',
          artifact: value.id,
          field: '/status'
        }];
        throw error;
      }
      return fixture.schemaRegistry.assertValid(entityType, value);
    }
  };
  const orchestrator = createExecutionOrchestrator({
    approvalValidator: fixture.approvalValidator,
    schemaRegistry,
    commandAdapter: createCommandAdapter(),
    crossReferenceValidator: fixture.crossReferenceValidator,
    projectRoot: ROOT,
    clock: fixture.clock
  });
  const result = await orchestrator.executeCommand(request(
    fixture,
    fixture.command
  ));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.run.status, 'blocked');
  assert.equal(result.attempt.status, 'blocked');
  assert.deepEqual(
    result.run_states.map((run) => run.status),
    ['running', 'blocked']
  );
  assert.deepEqual(
    result.attempt_states.map((attempt) => attempt.status),
    ['running', 'blocked']
  );
  assert.equal(result.attempts.at(-1).status, 'blocked');
  assert.equal(result.logs.stdout, 'retained-out\n');
  assert.equal(
    result.events.some((entry) => entry.type === 'command.terminal'),
    true
  );
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-contract:terminal-attempt-rejected'
    )),
    true
  );
});

test('blocked terminal fallback retains the original execution blocker', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const { createExecutionOrchestrator } = requireExecution();
  const fixture = executionFixture({
    script: (
      'process.stdout.write("failed-out\\n");'
        + 'process.stderr.write("failed-err\\n");'
        + 'process.exit(7);'
    )
  });
  const schemaRegistry = {
    assertValid(entityType, value) {
      if (entityType === 'attempt' && value.status === 'failed') {
        const error = new Error('failed terminal attempt rejected');
        error.blockers = [{
          id: 'verification-contract:terminal-attempt-rejected',
          artifact: value.id,
          field: '/status'
        }];
        throw error;
      }
      return fixture.schemaRegistry.assertValid(entityType, value);
    }
  };
  const orchestrator = createExecutionOrchestrator({
    approvalValidator: fixture.approvalValidator,
    schemaRegistry,
    commandAdapter: createCommandAdapter(),
    crossReferenceValidator: fixture.crossReferenceValidator,
    projectRoot: ROOT,
    clock: fixture.clock
  });

  const result = await orchestrator.executeCommand(request(
    fixture,
    fixture.command
  ));

  assert.equal(result.status, 'blocked');
  assert.equal(result.run.status, 'blocked');
  assert.equal(result.attempt.status, 'blocked');
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-execution:command-exit-nonzero'
    )),
    true,
    JSON.stringify(result.blockers)
  );
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-contract:terminal-attempt-rejected'
    )),
    true,
    JSON.stringify(result.blockers)
  );
  assert.deepEqual(
    result.events.slice(-3).map((entry) => entry.type),
    ['attempt.terminal', 'run.terminal', 'execution.contract-blocked']
  );
  assert.equal(result.events.at(-3).attempt.status, 'blocked');
  assert.equal(result.events.at(-2).run.status, 'blocked');
});

test('double terminal rejection preserves execution history without fake terminal artifacts', async () => {
  const { createCommandAdapter } = requireCommandAdapter();
  const { createExecutionOrchestrator } = requireExecution();
  const fixture = executionFixture({
    script: (
      'process.stdout.write("retained-out\\n");'
        + 'process.stderr.write("retained-err\\n");'
        + 'process.exit(7);'
    )
  });
  const schemaRegistry = {
    assertValid(entityType, value) {
      if (entityType === 'attempt' && value.status !== 'running') {
        const error = new Error(`terminal attempt rejected: ${value.status}`);
        error.blockers = [{
          id: `verification-contract:${value.status}-attempt-rejected`,
          artifact: value.id,
          field: '/status'
        }];
        throw error;
      }
      return fixture.schemaRegistry.assertValid(entityType, value);
    }
  };
  const orchestrator = createExecutionOrchestrator({
    approvalValidator: fixture.approvalValidator,
    schemaRegistry,
    commandAdapter: createCommandAdapter(),
    crossReferenceValidator: fixture.crossReferenceValidator,
    projectRoot: ROOT,
    clock: fixture.clock
  });

  const result = await orchestrator.executeCommand(request(
    fixture,
    fixture.command
  ));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.run, null);
  assert.equal(result.attempt, null);
  assert.deepEqual(
    result.run_states.map((run) => run.status),
    ['running']
  );
  assert.deepEqual(
    result.attempt_states.map((attempt) => attempt.status),
    ['running']
  );
  assert.equal(result.logs.stdout, 'retained-out\n');
  assert.equal(result.logs.stderr, 'retained-err\n');
  assert.equal(
    result.events.some((entry) => entry.type === 'command.terminal'),
    true
  );
  assert.deepEqual(
    result.events.slice(-3).map((entry) => entry.type),
    ['attempt.terminal', 'run.terminal', 'execution.contract-blocked']
  );
  assert.deepEqual(result.events.at(-3), {
    sequence: result.events.at(-3).sequence,
    type: 'attempt.terminal',
    at: result.events.at(-3).at,
    attempt: null,
    status: 'blocked',
    artifact_valid: false
  });
  assert.deepEqual(result.events.at(-2), {
    sequence: result.events.at(-2).sequence,
    type: 'run.terminal',
    at: result.events.at(-2).at,
    run: null,
    status: 'blocked',
    artifact_valid: false
  });
  for (const blockerId of [
    'verification-execution:command-exit-nonzero',
    'verification-contract:failed-attempt-rejected',
    'verification-contract:blocked-attempt-rejected'
  ]) {
    assert.equal(
      result.blockers.some((entry) => entry.id === blockerId),
      true,
      `${blockerId}: ${JSON.stringify(result.blockers)}`
    );
  }
});
