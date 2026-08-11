'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const DEFAULT_SHARD_COUNT = 4;
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
      stdio: options.stdio
    }
  };
}

function launchShard(spawnFunction, command, index) {
  let child;
  const completion = new Promise((resolve) => {
    let settled = false;
    child = spawnFunction(
      command.command,
      command.args,
      command.options
    );
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ child, index, ...result });
    };
    child.once('error', (error) => finish({
      code: null,
      signal: null,
      error
    }));
    child.once('exit', (code, signal) => finish({
      code,
      signal,
      error: null
    }));
  });
  return { child, completion };
}

async function runReleaseSuite(options = {}) {
  const cwd = options.cwd || path.resolve(__dirname, '../../..');
  const shardCount = options.shardCount || DEFAULT_SHARD_COUNT;
  integer(shardCount, 'shard-count', 1);
  const runtime = {
    cwd,
    env: options.env || process.env,
    nodePath: options.nodePath || process.execPath,
    shardCount,
    spawnFunction: options.spawnFunction || spawn,
    stdio: options.stdio || 'inherit',
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

  const children = [];
  let receivedSignal = null;
  const handlers = new Map();
  for (const signal of FORWARDED_SIGNALS) {
    const handler = () => {
      if (receivedSignal !== null) return;
      receivedSignal = signal;
      for (const child of children) {
        if (child && typeof child.kill === 'function') child.kill(signal);
      }
    };
    handlers.set(signal, handler);
    signalSource.once(signal, handler);
  }

  try {
    const executions = [];
    for (let index = 0; index < shardCount; index += 1) {
      const command = shardCommand(runtime, index);
      const execution = launchShard(
        runtime.spawnFunction,
        command,
        index
      );
      children[index] = execution.child;
      executions.push(execution.completion);
    }
    const results = await Promise.all(executions);
    const failures = results.filter((result) => (
      result.error !== null
      || result.signal !== null
      || result.code !== 0
    ));
    return {
      ok: failures.length === 0 && receivedSignal === null,
      shard_count: shardCount,
      results: results.map(({ child, ...result }) => result),
      received_signal: receivedSignal
    };
  } finally {
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
  DEFAULT_SHARD_COUNT,
  FORWARDED_SIGNALS,
  SHARD_COUNT_ENV,
  SHARD_INDEX_ENV,
  createShardTest,
  parseShardConfig,
  runReleaseSuite,
  shardAssignments,
  shardCommand
};
