'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  SHARD_COUNT_ENV,
  SHARD_INDEX_ENV,
  createShardTest,
  parseShardConfig,
  runReleaseSuite,
  shardAssignments
} = require('./release-suite-runner');

function fakeChild(result, kills = []) {
  const child = new EventEmitter();
  child.kill = (signal) => {
    kills.push(signal);
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
  const result = await runReleaseSuite({
    cwd: '/repo',
    env: { BASE: 'kept' },
    nodePath: '/node',
    shardCount: 4,
    signalSource: new EventEmitter(),
    spawnFunction(command, args, options) {
      invocations.push({ command, args, options });
      return fakeChild({ code: 0 });
    },
    stdio: 'pipe',
    testFile: '/repo/release-proof.test.js'
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 4);
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

test('parent termination is forwarded to every active shard', async () => {
  const signalSource = new EventEmitter();
  const kills = Array.from({ length: 4 }, () => []);
  let index = 0;
  const pending = runReleaseSuite({
    shardCount: 4,
    signalSource,
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
});
