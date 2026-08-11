'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SHARD_COUNT_ENV,
  SHARD_INDEX_ENV,
  createShardTest,
  parseShardConfig,
  runReleaseSuite,
  shardAssignments,
  terminateProcessGroup
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

function fakeTerminate(child, signal) {
  return child.kill(signal);
}

async function waitForFile(file, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error('timed out waiting for process exit'));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for process ${pid} to exit`);
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

test('waitForExit removes exit listeners after success and timeout', async () => {
  const exitedChild = new EventEmitter();
  exitedChild.exitCode = null;
  exitedChild.signalCode = null;
  const exited = waitForExit(exitedChild, 1000);
  assert.equal(exitedChild.listenerCount('exit'), 1);
  exitedChild.emit('exit', 0, null);
  await exited;
  assert.equal(exitedChild.listenerCount('exit'), 0);

  const timedOutChild = new EventEmitter();
  timedOutChild.exitCode = null;
  timedOutChild.signalCode = null;
  await assert.rejects(
    waitForExit(timedOutChild, 5),
    /timed out waiting for process exit/
  );
  assert.equal(timedOutChild.listenerCount('exit'), 0);
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
    assert.equal(invocation.options.detached, true);
  }
});

test('a failed shard fails the suite without hiding successful shards', async () => {
  let index = 0;
  const result = await runReleaseSuite({
    shardCount: 4,
    signalSource: new EventEmitter(),
    terminationGraceMs: 5,
    forceWaitMs: 5,
    terminateProcess: fakeTerminate,
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
    terminationGraceMs: 5,
    forceWaitMs: 5,
    terminateProcess: fakeTerminate,
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
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.results.length, 1);
});

test('asynchronous spawn errors and child signals fail the suite', async () => {
  const kills = Array.from({ length: 4 }, () => []);
  let index = 0;
  const result = await runReleaseSuite({
    shardCount: 4,
    signalSource: new EventEmitter(),
    terminationGraceMs: 5,
    forceWaitMs: 5,
    terminateProcess: fakeTerminate,
    spawnFunction() {
      const current = index;
      index += 1;
      if (current === 0) {
        return fakeChild({ code: 0 }, kills[current]);
      }
      if (current === 1) {
        return fakeChild({ error: new Error('async spawn error') });
      }
      if (current === 2) {
        return fakeChild({ code: null, signal: 'SIGABRT' });
      }
      return fakeChild(null, kills[current]);
    },
    stdio: 'pipe'
  });

  assert.equal(result.ok, false);
  assert.equal(result.launch_error, 'async spawn error');
  assert.equal(result.results[1].error, 'async spawn error');
  assert.equal(result.results[2].signal, 'SIGABRT');
  assert.deepEqual(kills[0], ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(kills[3], ['SIGTERM', 'SIGKILL']);
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
    terminateProcess: fakeTerminate,
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
    ['SIGTERM', 'SIGKILL'],
    ['SIGTERM', 'SIGKILL'],
    ['SIGTERM', 'SIGKILL'],
    ['SIGTERM', 'SIGKILL']
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
    terminateProcess: fakeTerminate,
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

test('process-group termination reaches a real test worker descendant', async (t) => {
  if (process.platform === 'win32') {
    const calls = [];
    terminateProcessGroup({ pid: 4321 }, 'SIGKILL', {
      spawnSyncFunction(command, args) {
        calls.push({ command, args });
        return { status: 0, stderr: '' };
      }
    });
    assert.deepEqual(calls, [{
      command: 'taskkill.exe',
      args: ['/pid', '4321', '/T', '/F']
    }]);
    return;
  }

  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-release-process-group-')
  );
  const readyFile = path.join(root, 'ready.json');
  const markerFile = path.join(root, 'worker-signal.txt');
  const workerSource = [
    "'use strict';",
    "const fs = require('node:fs');",
    'const marker = process.argv[1];',
    "process.on('SIGTERM', () => {",
    "  fs.writeFileSync(marker, 'SIGTERM\\n');",
    '  process.exit(0);',
    '});',
    "if (process.send) process.send('ready');",
    'setInterval(() => {}, 1000);'
  ].join('\n');
  const parentSource = [
    "'use strict';",
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const ready = process.argv[1];',
    'const marker = process.argv[2];',
    `const worker = spawn(process.execPath, ['-e', ${JSON.stringify(
      workerSource
    )}, marker], {`,
    "  stdio: ['ignore', 'ignore', 'ignore', 'ipc']",
    '});',
    "worker.once('message', () => {",
    '  fs.writeFileSync(ready, JSON.stringify({',
    '    parent_pid: process.pid,',
    '    worker_pid: worker.pid',
    '  }));',
    '});',
    'setInterval(() => {}, 1000);'
  ].join('\n');
  const parent = spawn(
    process.execPath,
    ['-e', parentSource, readyFile, markerFile],
    {
      detached: true,
      stdio: 'ignore'
    }
  );
  t.after(() => {
    try {
      process.kill(-parent.pid, 'SIGKILL');
    } catch {
      // The process group is expected to have exited.
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitForFile(readyFile);
  terminateProcessGroup(parent, 'SIGTERM');
  await waitForExit(parent);
  await waitForFile(markerFile);
  assert.equal(fs.readFileSync(markerFile, 'utf8'), 'SIGTERM\n');
});

test('SIGKILL escalation cleans a worker after its coordinator exits', async (t) => {
  if (process.platform === 'win32') {
    const calls = [];
    const signalSource = new EventEmitter();
    const child = fakeChild(null);
    child.pid = 4321;
    const pending = runReleaseSuite({
      shardCount: 1,
      signalSource,
      terminationGraceMs: 5,
      forceWaitMs: 5,
      spawnFunction() {
        queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
        return child;
      },
      terminateProcess(target, signal) {
        calls.push({ pid: target.pid, signal });
        return true;
      },
      stdio: 'pipe'
    });
    queueMicrotask(() => signalSource.emit('SIGTERM'));
    await pending;
    assert.deepEqual(calls, [
      { pid: 4321, signal: 'SIGTERM' },
      { pid: 4321, signal: 'SIGKILL' }
    ]);
    return;
  }

  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-release-stubborn-worker-')
  );
  const readyFile = path.join(root, 'ready.json');
  const markerFile = path.join(root, 'worker-ignored-term.txt');
  const workerSource = [
    "'use strict';",
    "const fs = require('node:fs');",
    'const marker = process.argv[1];',
    "process.on('SIGTERM', () => {",
    "  fs.writeFileSync(marker, 'ignored SIGTERM\\n');",
    '});',
    "if (process.send) process.send('ready');",
    'setInterval(() => {}, 1000);'
  ].join('\n');
  const parentSource = [
    "'use strict';",
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const ready = process.argv[1];',
    'const marker = process.argv[2];',
    `const worker = spawn(process.execPath, ['-e', ${JSON.stringify(
      workerSource
    )}, marker], {`,
    "  stdio: ['ignore', 'ignore', 'ignore', 'ipc']",
    '});',
    "worker.once('message', () => {",
    '  fs.writeFileSync(ready, JSON.stringify({',
    '    parent_pid: process.pid,',
    '    worker_pid: worker.pid',
    '  }));',
    '});',
    'setInterval(() => {}, 1000);'
  ].join('\n');
  let parent;
  const signalSource = new EventEmitter();
  const pending = runReleaseSuite({
    shardCount: 1,
    signalSource,
    terminationGraceMs: 50,
    forceWaitMs: 50,
    spawnFunction() {
      parent = spawn(
        process.execPath,
        ['-e', parentSource, readyFile, markerFile],
        {
          detached: true,
          stdio: 'ignore'
        }
      );
      return parent;
    },
    stdio: 'pipe'
  });
  t.after(() => {
    if (parent) {
      try {
        process.kill(-parent.pid, 'SIGKILL');
      } catch {
        // The process group is expected to have exited.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitForFile(readyFile);
  const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
  signalSource.emit('SIGTERM');
  const result = await pending;
  await waitForFile(markerFile);
  await waitForProcessExit(ready.worker_pid);

  assert.equal(result.ok, false);
  assert.equal(result.received_signal, 'SIGTERM');
  assert.equal(fs.readFileSync(markerFile, 'utf8'), 'ignored SIGTERM\n');
  assert.equal(processExists(ready.worker_pid), false);
});

test('release shell forwards adapter termination to its active Node command', async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-release-shell-signal-')
  );
  const nodeFile = path.join(root, 'node');
  const pidFile = path.join(root, 'node.pid');
  const markerFile = path.join(root, 'node-signal.txt');
  fs.writeFileSync(nodeFile, [
    '#!/usr/bin/env bash',
    'if [[ "${1:-}" == "--check" ]]; then exit 0; fi',
    'printf "%s\\n" "$$" > "$SPECNAV_TEST_CHILD_PID_FILE"',
    "trap 'printf \"TERM\\\\n\" > \"$SPECNAV_TEST_SIGNAL_FILE\"; exit 143' TERM",
    'while true; do sleep 1; done',
    ''
  ].join('\n'), { mode: 0o755 });
  const shell = spawn('/bin/bash', [RELEASE_RUNNER], {
    cwd: path.resolve(__dirname, '../../..'),
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      SPECNAV_TEST_CHILD_PID_FILE: pidFile,
      SPECNAV_TEST_SIGNAL_FILE: markerFile
    },
    stdio: 'ignore'
  });
  t.after(() => {
    try {
      shell.kill('SIGKILL');
    } catch {
      // The shell is expected to have exited.
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitForFile(pidFile);
  shell.kill('SIGTERM');
  await waitForExit(shell);
  await waitForFile(markerFile);
  assert.equal(fs.readFileSync(markerFile, 'utf8'), 'TERM\n');
});

test('release shell terminates during managed Python preflight without continuing', async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-release-preflight-signal-')
  );
  const pythonFile = path.join(root, 'python3');
  const nodeFile = path.join(root, 'node');
  const pidFile = path.join(root, 'python.pid');
  const markerFile = path.join(root, 'python-signal.txt');
  const continuedFile = path.join(root, 'node-ran.txt');
  fs.writeFileSync(pythonFile, [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$$" > "$SPECNAV_TEST_CHILD_PID_FILE"',
    "trap 'printf \"TERM\\\\n\" > \"$SPECNAV_TEST_SIGNAL_FILE\"; exit 143' TERM",
    'while true; do sleep 1; done',
    ''
  ].join('\n'), { mode: 0o755 });
  fs.writeFileSync(nodeFile, [
    '#!/usr/bin/env bash',
    'printf "continued\\n" > "$SPECNAV_TEST_CONTINUED_FILE"',
    'exit 0',
    ''
  ].join('\n'), { mode: 0o755 });
  const shell = spawn('/bin/bash', [RELEASE_RUNNER], {
    cwd: path.resolve(__dirname, '../../..'),
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      SPECNAV_TEST_CHILD_PID_FILE: pidFile,
      SPECNAV_TEST_SIGNAL_FILE: markerFile,
      SPECNAV_TEST_CONTINUED_FILE: continuedFile
    },
    stdio: 'ignore'
  });
  t.after(() => {
    try {
      shell.kill('SIGKILL');
    } catch {
      // The shell is expected to have exited.
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitForFile(pidFile);
  shell.kill('SIGTERM');
  await waitForExit(shell);
  await waitForFile(markerFile);
  assert.equal(fs.readFileSync(markerFile, 'utf8'), 'TERM\n');
  assert.equal(fs.existsSync(continuedFile), false);
});

test('release shell manages assertion emission after a failed command', async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-release-assertion-signal-')
  );
  const nodeFile = path.join(root, 'node');
  const pidFile = path.join(root, 'emitter.pid');
  const markerFile = path.join(root, 'emitter-signal.txt');
  const resultFile = path.join(root, 'assertion-results.jsonl');
  fs.writeFileSync(nodeFile, [
    '#!/usr/bin/env bash',
    'if [[ "${1:-}" == "--check" ]]; then exit 1; fi',
    'printf "%s\\n" "$$" > "$SPECNAV_TEST_CHILD_PID_FILE"',
    "trap 'printf \"TERM\\\\n\" > \"$SPECNAV_TEST_SIGNAL_FILE\"; exit 143' TERM",
    'while true; do sleep 1; done',
    ''
  ].join('\n'), { mode: 0o755 });
  const shell = spawn('/bin/bash', [RELEASE_RUNNER], {
    cwd: path.resolve(__dirname, '../../..'),
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      SPECNAV_TEST_CHILD_PID_FILE: pidFile,
      SPECNAV_TEST_SIGNAL_FILE: markerFile,
      SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_EMITTED: '0',
      SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_OWNER_PID: '',
      SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: resultFile,
      SPECNAV_VERIFICATION_ASSERTION_IDS: 'CASE-08-A01,CASE-08-A02,CASE-08-A03'
    },
    stdio: 'ignore'
  });
  t.after(() => {
    try {
      shell.kill('SIGKILL');
    } catch {
      // The shell is expected to have exited.
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitForFile(pidFile);
  shell.kill('SIGTERM');
  await waitForExit(shell);
  await waitForFile(markerFile);
  assert.equal(fs.readFileSync(markerFile, 'utf8'), 'TERM\n');
});

test('release shell emits failed assertions when Python is unavailable', async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-release-python-missing-')
  );
  const nodeFile = path.join(root, 'node');
  const resultFile = path.join(root, 'assertion-results.jsonl');
  fs.symlinkSync(process.execPath, nodeFile);
  const shell = spawn('/bin/bash', [RELEASE_RUNNER], {
    cwd: path.resolve(__dirname, '../../..'),
    env: {
      ...process.env,
      PATH: root,
      SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_EMITTED: '0',
      SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_OWNER_PID: '',
      SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: resultFile,
      SPECNAV_VERIFICATION_ASSERTION_IDS: 'CASE-08-A01,CASE-08-A02,CASE-08-A03'
    },
    stdio: 'ignore'
  });
  t.after(() => {
    try {
      shell.kill('SIGKILL');
    } catch {
      // The shell is expected to have exited.
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitForExit(shell);
  assert.notEqual(shell.exitCode, 0);
  await waitForFile(resultFile);
  const records = fs.readFileSync(resultFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((record) => [record.assertion_id, record.status]),
    [
      ['CASE-08-A01', 'failed'],
      ['CASE-08-A02', 'failed'],
      ['CASE-08-A03', 'failed']
    ]
  );
});

test('release shell dynamically includes support tests and excludes the sharded file', () => {
  const source = fs.readFileSync(RELEASE_RUNNER, 'utf8');
  assert.match(
    source,
    /for test_file in tests\/verification-v2\/release\/\*\.test\.js/
  );
  assert.match(source, /release-proof\.test\.js/);
  assert.match(source, /support_tests\+=/);
  assert.match(source, /exit "\$\(signal_status "\$signal"\)"/);
  assert.doesNotMatch(source, /\bdirname\b/);
  assert.match(source, /node\(\) \{\s*run_managed "\$NODE_BIN"/);
  assert.match(source, /finishing=1/);
  assert.match(source, /launching=1[\s\S]*active_pid=\$![\s\S]*launching=0/);
  assert.match(
    source,
    /if \[\[ "\$launching" -eq 1 \]\]; then\s*return/
  );
});
