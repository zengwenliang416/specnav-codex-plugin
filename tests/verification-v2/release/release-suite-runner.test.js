'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  SHARD_COUNT_ENV,
  SHARD_INDEX_ENV,
  createShardTest,
  parseShardConfig,
  runReleaseSuite,
  shardAssignments
} = require('./release-suite-runner');

const RELEASE_RUNNER = path.resolve(
  __dirname,
  '../../run-verification-v2-release.sh'
);

function fakeChild(result, kills = [], options = {}) {
  const child = new EventEmitter();
  child.unref = () => {
    if (options.unrefs) options.unrefs.push(true);
  };
  child.kill = (signal) => {
    kills.push(signal);
    if (options.killError) throw options.killError;
    if (options.killResult === false) return false;
    queueMicrotask(() => child.emit('exit', null, signal));
    return true;
  };
  if (result) {
    queueMicrotask(() => {
      if (result.error) child.emit('error', result.error);
      else child.emit('exit', result.code, result.signal || null);
    });
  }
  return child;
}

test('shard configuration is explicit and fails closed', () => {
  assert.equal(parseShardConfig({}), null);
  assert.deepEqual(parseShardConfig({
    [SHARD_COUNT_ENV]: '4',
    [SHARD_INDEX_ENV]: '2'
  }), {
    count: 4,
    index: 2
  });
  assert.throws(
    () => parseShardConfig({ [SHARD_COUNT_ENV]: '4' }),
    /shard-config-incomplete/
  );
  assert.throws(
    () => parseShardConfig({
      [SHARD_COUNT_ENV]: '4',
      [SHARD_INDEX_ENV]: '4'
    }),
    /shard-index-out-of-range/
  );
});

test('43 release tests are assigned exactly once across four shards', () => {
  const assignments = shardAssignments(43, 4);
  assert.deepEqual(assignments.map((values) => values.length), [11, 11, 11, 10]);
  const flattened = assignments.flat().sort((left, right) => left - right);
  assert.deepEqual(
    flattened,
    Array.from({ length: 43 }, (_, index) => index)
  );
  assert.equal(new Set(flattened).size, 43);
});

test('test registration selects only the current deterministic shard', () => {
  const registered = [];
  const shardTest = createShardTest(
    (name) => registered.push(name),
    {
      [SHARD_COUNT_ENV]: '4',
      [SHARD_INDEX_ENV]: '2'
    }
  );
  for (let index = 0; index < 10; index += 1) {
    shardTest(`test-${index}`, () => {});
  }
  assert.deepEqual(registered, ['test-2', 'test-6']);
});

test('release suite launches four shards with isolated shard identities', async () => {
  const invocations = [];
  const signalSource = new EventEmitter();
  const result = await runReleaseSuite({
    cwd: '/repo',
    env: { BASE: 'kept' },
    nodePath: '/node',
    shardCount: 4,
    signalSource,
    spawnFunction(command, args, options) {
      invocations.push({ command, args, options });
      return fakeChild({ code: 0 });
    },
    stdio: 'pipe',
    testFile: '/repo/release-proof.test.js'
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 4);
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
  assert.deepEqual(
    invocations.map((entry) => entry.options.env[SHARD_INDEX_ENV]),
    ['0', '1', '2', '3']
  );
  for (const invocation of invocations) {
    assert.equal(invocation.command, '/node');
    assert.deepEqual(invocation.args, [
      '--test',
      '/repo/release-proof.test.js'
    ]);
    assert.equal(invocation.options.env[SHARD_COUNT_ENV], '4');
    assert.equal(invocation.options.env.BASE, 'kept');
  }
});

test('a failed shard fails the suite without hiding successful shards', async () => {
  let index = 0;
  const result = await runReleaseSuite({
    shardCount: 4,
    signalSource: new EventEmitter(),
    spawnFunction() {
      const current = index;
      index += 1;
      return fakeChild({ code: current === 2 ? 1 : 0 });
    },
    stdio: 'pipe'
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.results.map((entry) => entry.code),
    [0, 0, 1, 0]
  );
});

test('a synchronous spawn failure stops launch and terminates active shards', async () => {
  const kills = [];
  let calls = 0;
  const result = await runReleaseSuite({
    shardCount: 4,
    signalSource: new EventEmitter(),
    spawnFunction() {
      calls += 1;
      if (calls === 2) throw new Error('spawn denied');
      return fakeChild(null, kills);
    },
    stdio: 'pipe'
  });

  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.launch_error, 'spawn denied');
  assert.deepEqual(kills, ['SIGTERM']);
  assert.equal(result.results.length, 1);
});

test('asynchronous spawn errors and child signals fail the suite', async () => {
  let index = 0;
  const result = await runReleaseSuite({
    shardCount: 4,
    signalSource: new EventEmitter(),
    spawnFunction() {
      const current = index;
      index += 1;
      if (current === 1) {
        return fakeChild({ error: new Error('async spawn error') });
      }
      if (current === 2) {
        return fakeChild({ code: null, signal: 'SIGABRT' });
      }
      return fakeChild({ code: 0 });
    },
    stdio: 'pipe'
  });

  assert.equal(result.ok, false);
  assert.equal(result.results[1].error, 'async spawn error');
  assert.equal(result.results[2].signal, 'SIGABRT');
});

test('parent termination is forwarded to every active shard', async () => {
  const signalSource = new EventEmitter();
  const kills = Array.from({ length: 4 }, () => []);
  let index = 0;
  const pending = runReleaseSuite({
    shardCount: 4,
    signalSource,
    terminationGraceMs: 5,
    forceWaitMs: 5,
    spawnFunction() {
      const current = index;
      index += 1;
      return fakeChild(null, kills[current]);
    },
    stdio: 'pipe'
  });

  queueMicrotask(() => signalSource.emit('SIGTERM'));
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.received_signal, 'SIGTERM');
  assert.deepEqual(kills, [
    ['SIGTERM'],
    ['SIGTERM'],
    ['SIGTERM'],
    ['SIGTERM']
  ]);
  assert.deepEqual(
    result.results.map((entry) => entry.signal),
    ['SIGTERM', 'SIGTERM', 'SIGTERM', 'SIGTERM']
  );
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
});

test('ignored termination is escalated and forcibly settled', async () => {
  const signalSource = new EventEmitter();
  const kills = [];
  const unrefs = [];
  const pending = runReleaseSuite({
    shardCount: 1,
    signalSource,
    terminationGraceMs: 5,
    forceWaitMs: 5,
    spawnFunction() {
      return fakeChild(null, kills, {
        killResult: false,
        unrefs
      });
    },
    stdio: 'pipe'
  });

  queueMicrotask(() => signalSource.emit('SIGTERM'));
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.received_signal, 'SIGTERM');
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(unrefs, [true]);
  assert.equal(
    result.results[0].error,
    'verification-release:shard-termination-timeout'
  );
  assert.equal(result.termination_errors.length, 2);
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
});

test('release shell dynamically includes support tests and excludes the sharded file', () => {
  const source = fs.readFileSync(RELEASE_RUNNER, 'utf8');
  assert.match(
    source,
    /for test_file in tests\/verification-v2\/release\/\*\.test\.js/
  );
  assert.match(source, /release-proof\.test\.js/);
  assert.match(source, /support_tests\+=/);
});
