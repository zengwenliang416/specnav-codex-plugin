'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const DEFAULT_SHARD_COUNT = 4;
const DEFAULT_TERMINATION_GRACE_MS = 5000;
const DEFAULT_FORCE_WAIT_MS = 5000;
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

function launchShard(spawnFunction, command, index, onSpawnError) {
  const child = spawnFunction(
    command.command,
    command.args,
    command.options
  );
  let finish;
  let settled = false;
  const completion = new Promise((resolve) => {
    finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ child, index, ...result });
    };
    child.once('error', (error) => {
      finish({
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error)
      });
      onSpawnError(error, index);
    });
    child.once('exit', (code, signal) => finish({
      code,
      signal,
      error: null
    }));
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
  });
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
          (error) => {
            if (launchError === null) {
              launchError = error instanceof Error
                ? error.message
                : String(error);
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

async function main() {
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
  DEFAULT_SHARD_COUNT,
  DEFAULT_TERMINATION_GRACE_MS,
  FORWARDED_SIGNALS,
  SHARD_COUNT_ENV,
  SHARD_INDEX_ENV,
  createShardTest,
  parseShardConfig,
  runReleaseSuite,
  shardAssignments,
  shardCommand,
  terminateProcessGroup
};
