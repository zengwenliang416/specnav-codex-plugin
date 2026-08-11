'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const DEFAULT_SHARD_COUNT = 4;
const DEFAULT_TERMINATION_GRACE_MS = 5000;
const DEFAULT_FORCE_WAIT_MS = 5000;
const DEFAULT_MANAGED_TERMINATION_GRACE_MS = 1000;
const DEFAULT_MANAGED_FORCE_WAIT_MS = 1000;
const SHARD_COUNT_ENV = 'SPECNAV_RELEASE_PROOF_SHARD_COUNT';
const SHARD_INDEX_ENV = 'SPECNAV_RELEASE_PROOF_SHARD_INDEX';
const FORWARDED_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);

function integer(value, name, minimum) {
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`verification-release:${name}-invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`verification-release:${name}-invalid`);
  }
  return parsed;
}

function parseShardConfig(env = process.env) {
  const countValue = env[SHARD_COUNT_ENV];
  const indexValue = env[SHARD_INDEX_ENV];
  if (countValue === undefined && indexValue === undefined) return null;
  if (countValue === undefined || indexValue === undefined) {
    throw new Error('verification-release:shard-config-incomplete');
  }
  const count = integer(countValue, 'shard-count', 1);
  const index = integer(indexValue, 'shard-index', 0);
  if (index >= count) {
    throw new Error('verification-release:shard-index-out-of-range');
  }
  return Object.freeze({ count, index });
}

function shardAssignments(total, count = DEFAULT_SHARD_COUNT) {
  const normalizedTotal = integer(total, 'test-count', 0);
  const normalizedCount = integer(count, 'shard-count', 1);
  const assignments = Array.from(
    { length: normalizedCount },
    () => []
  );
  for (let index = 0; index < normalizedTotal; index += 1) {
    assignments[index % normalizedCount].push(index);
  }
  return assignments;
}

function createShardTest(testFunction, env = process.env) {
  if (typeof testFunction !== 'function') {
    throw new Error('verification-release:test-function-invalid');
  }
  const config = parseShardConfig(env);
  let testIndex = 0;
  return (...args) => {
    const currentIndex = testIndex;
    testIndex += 1;
    if (
      config === null
      || currentIndex % config.count === config.index
    ) {
      return testFunction(...args);
    }
    return undefined;
  };
}

function shardCommand(options, index) {
  return {
    command: options.nodePath,
    args: ['--test', options.testFile],
    options: {
      cwd: options.cwd,
      env: {
        ...options.env,
        [SHARD_COUNT_ENV]: String(options.shardCount),
        [SHARD_INDEX_ENV]: String(index)
      },
      detached: true,
      stdio: options.stdio
    }
  };
}

function launchShard(spawnFunction, command, index, onTerminalFailure) {
  const child = spawnFunction(
    command.command,
    command.args,
    command.options
  );
  let finish;
  let settled = false;
  const completion = new Promise((resolve) => {
    const onError = (error) => {
      const result = {
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error)
      };
      if (finish(result)) onTerminalFailure(result, index);
    };
    const onExit = (code, signal) => {
      const result = {
        code,
        signal,
        error: null
      };
      if (
        finish(result)
        && (code !== 0 || signal !== null)
      ) {
        onTerminalFailure(result, index);
      }
    };
    finish = (result, options = {}) => {
      if (settled) return false;
      settled = true;
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (options.orphaned === true) {
        const onOrphanError = () => {};
        const onOrphanClose = () => {
          child.removeListener('error', onOrphanError);
          child.removeListener('close', onOrphanClose);
        };
        child.on('error', onOrphanError);
        child.once('close', onOrphanClose);
      }
      resolve({ child, index, ...result });
      return true;
    };
    child.once('error', onError);
    child.once('exit', onExit);
  });
  return {
    child,
    completion,
    finish,
    index,
    get settled() {
      return settled;
    }
  };
}

function terminateProcessGroup(child, signal, dependencies = {}) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) {
    throw new Error('verification-release:shard-pid-invalid');
  }
  if (process.platform === 'win32') {
    const run = dependencies.spawnSyncFunction || spawnSync;
    const args = ['/pid', String(child.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const result = run('taskkill.exe', args, {
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.status !== 0) {
      throw new Error(
        result.stderr?.trim()
        || 'verification-release:taskkill-failed'
      );
    }
    return true;
  }
  const kill = dependencies.killProcess || process.kill;
  try {
    kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  return true;
}

function killExecution(
  execution,
  signal,
  errors,
  terminateProcess,
  includeSettled = false
) {
  if (execution.settled && !includeSettled) return;
  try {
    if (terminateProcess(execution.child, signal) === false) {
      errors.push({
        index: execution.index,
        signal,
        error: 'verification-release:shard-kill-rejected'
      });
    }
  } catch (error) {
    errors.push({
      index: execution.index,
      signal,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function forceSettle(execution) {
  if (execution.settled) return;
  if (typeof execution.child.unref === 'function') {
    try {
      execution.child.unref();
    } catch {
      // Completion still fails closed even if the child cannot be unrefed.
    }
  }
  execution.finish({
    code: null,
    signal: null,
    error: 'verification-release:shard-termination-timeout'
  }, {
    orphaned: true
  });
}

function processGroupExists(child, dependencies = {}) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
  if (process.platform === 'win32') return false;
  const kill = dependencies.killProcess || process.kill;
  try {
    kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function runManagedCommand(options = {}) {
  if (typeof options.command !== 'string' || options.command.length === 0) {
    throw new Error('verification-release:managed-command-required');
  }
  const terminationGraceMs = options.terminationGraceMs
    ?? DEFAULT_MANAGED_TERMINATION_GRACE_MS;
  const forceWaitMs = options.forceWaitMs ?? DEFAULT_MANAGED_FORCE_WAIT_MS;
  integer(terminationGraceMs, 'termination-grace-ms', 0);
  integer(forceWaitMs, 'force-wait-ms', 0);
  const signalSource = options.signalSource || process;
  const terminateProcess = options.terminateProcess || terminateProcessGroup;
  const groupExists = options.processGroupExists || processGroupExists;
  const terminationErrors = [];
  const handlers = new Map();
  let execution = null;
  let receivedSignal = null;
  let shutdownStarted = false;
  let shutdownResolved = false;
  let escalationTimer = null;
  let forceTimer = null;
  let resolveShutdown;
  const shutdownCompletion = new Promise((resolve) => {
    resolveShutdown = resolve;
  });
  const finishShutdown = () => {
    if (shutdownResolved) return;
    shutdownResolved = true;
    resolveShutdown();
  };
  const beginShutdown = (signal) => {
    if (shutdownStarted || execution === null) return;
    shutdownStarted = true;
    killExecution(
      execution,
      signal,
      terminationErrors,
      terminateProcess,
      true
    );
    escalationTimer = setTimeout(() => {
      killExecution(
        execution,
        'SIGKILL',
        terminationErrors,
        terminateProcess,
        true
      );
    }, terminationGraceMs);
    forceTimer = setTimeout(() => {
      forceSettle(execution);
      finishShutdown();
    }, terminationGraceMs + forceWaitMs);
  };
  for (const signal of FORWARDED_SIGNALS) {
    const handler = () => {
      if (receivedSignal !== null) return;
      receivedSignal = signal;
      beginShutdown(signal);
    };
    handlers.set(signal, handler);
    signalSource.once(signal, handler);
  }

  try {
    const command = {
      command: options.command,
      args: options.args || [],
      options: {
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        detached: true,
        stdio: options.stdio || 'inherit'
      }
    };
    execution = launchShard(
      options.spawnFunction || spawn,
      command,
      0,
      () => {}
    );
    if (receivedSignal !== null) beginShutdown(receivedSignal);
    const result = await execution.completion;
    if (
      !shutdownStarted
      && groupExists(execution.child)
    ) {
      beginShutdown('SIGTERM');
    }
    if (
      shutdownStarted
      && !groupExists(execution.child)
    ) {
      finishShutdown();
    }
    if (shutdownStarted) await shutdownCompletion;
    return {
      ok: result.code === 0
        && result.signal === null
        && result.error === null
        && receivedSignal === null
        && terminationErrors.length === 0,
      code: result.code,
      signal: result.signal,
      error: result.error,
      received_signal: receivedSignal,
      termination_errors: terminationErrors
    };
  } finally {
    if (escalationTimer !== null) clearTimeout(escalationTimer);
    if (forceTimer !== null) clearTimeout(forceTimer);
    for (const [signal, handler] of handlers) {
      signalSource.removeListener(signal, handler);
    }
  }
}

async function runReleaseSuite(options = {}) {
  const cwd = options.cwd || path.resolve(__dirname, '../../..');
  const shardCount = options.shardCount ?? DEFAULT_SHARD_COUNT;
  const terminationGraceMs = options.terminationGraceMs
    ?? DEFAULT_TERMINATION_GRACE_MS;
  const forceWaitMs = options.forceWaitMs ?? DEFAULT_FORCE_WAIT_MS;
  integer(shardCount, 'shard-count', 1);
  integer(terminationGraceMs, 'termination-grace-ms', 0);
  integer(forceWaitMs, 'force-wait-ms', 0);
  const runtime = {
    cwd,
    env: options.env || process.env,
    nodePath: options.nodePath || process.execPath,
    shardCount,
    spawnFunction: options.spawnFunction || spawn,
    stdio: options.stdio || 'inherit',
    terminateProcess: options.terminateProcess || terminateProcessGroup,
    testFile: options.testFile || path.join(__dirname, 'release-proof.test.js')
  };
  const signalSource = options.signalSource || process;
  if (
    !(signalSource instanceof EventEmitter)
    && (
      typeof signalSource.once !== 'function'
      || typeof signalSource.removeListener !== 'function'
    )
  ) {
    throw new Error('verification-release:signal-source-invalid');
  }

  const executions = [];
  let receivedSignal = null;
  let launchError = null;
  let shutdownStarted = false;
  let escalationTimer = null;
  let forceTimer = null;
  let resolveShutdown;
  const shutdownCompletion = new Promise((resolve) => {
    resolveShutdown = resolve;
  });
  const terminationErrors = [];
  const handlers = new Map();
  const beginShutdown = (signal) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    for (const execution of executions) {
      killExecution(
        execution,
        signal,
        terminationErrors,
        runtime.terminateProcess,
        true
      );
    }
    escalationTimer = setTimeout(() => {
      for (const execution of executions) {
        killExecution(
          execution,
          'SIGKILL',
          terminationErrors,
          runtime.terminateProcess,
          true
        );
      }
    }, terminationGraceMs);
    forceTimer = setTimeout(() => {
      for (const execution of executions) forceSettle(execution);
      resolveShutdown();
    }, terminationGraceMs + forceWaitMs);
  };
  for (const signal of FORWARDED_SIGNALS) {
    const handler = () => {
      if (receivedSignal !== null) return;
      receivedSignal = signal;
      beginShutdown(signal);
    };
    handlers.set(signal, handler);
    signalSource.once(signal, handler);
  }

  try {
    for (let index = 0; index < shardCount; index += 1) {
      const command = shardCommand(runtime, index);
      try {
        executions.push(launchShard(
          runtime.spawnFunction,
          command,
          index,
          (result) => {
            if (result.error !== null && launchError === null) {
              launchError = result.error;
            }
            beginShutdown('SIGTERM');
          }
        ));
      } catch (error) {
        launchError = error instanceof Error ? error.message : String(error);
        beginShutdown('SIGTERM');
        break;
      }
    }
    const results = await Promise.all(
      executions.map((execution) => execution.completion)
    );
    if (shutdownStarted) await shutdownCompletion;
    const failures = results.filter((result) => (
      result.error !== null
      || result.signal !== null
      || result.code !== 0
    ));
    return {
      ok: failures.length === 0
        && receivedSignal === null
        && launchError === null
        && terminationErrors.length === 0,
      shard_count: shardCount,
      results: results.map(({ child, ...result }) => result),
      received_signal: receivedSignal,
      launch_error: launchError,
      termination_errors: terminationErrors
    };
  } finally {
    if (escalationTimer !== null) clearTimeout(escalationTimer);
    if (forceTimer !== null) clearTimeout(forceTimer);
    for (const [signal, handler] of handlers) {
      signalSource.removeListener(signal, handler);
    }
  }
}

async function main(args = process.argv.slice(2)) {
  if (args[0] === '--managed-command') {
    if (args[1] !== '--' || typeof args[2] !== 'string') {
      throw new Error('verification-release:managed-command-required');
    }
    const result = await runManagedCommand({
      command: args[2],
      args: args.slice(3)
    });
    const signal = result.received_signal || result.signal;
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = result.ok ? 0 : (result.code || 1);
    return;
  }
  const result = await runReleaseSuite();
  if (result.received_signal !== null) {
    process.kill(process.pid, result.received_signal);
    return;
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_FORCE_WAIT_MS,
  DEFAULT_MANAGED_FORCE_WAIT_MS,
  DEFAULT_MANAGED_TERMINATION_GRACE_MS,
  DEFAULT_SHARD_COUNT,
  DEFAULT_TERMINATION_GRACE_MS,
  FORWARDED_SIGNALS,
  SHARD_COUNT_ENV,
  SHARD_INDEX_ENV,
  createShardTest,
  parseShardConfig,
  processGroupExists,
  runManagedCommand,
  runReleaseSuite,
  shardAssignments,
  shardCommand,
  terminateProcessGroup
};
