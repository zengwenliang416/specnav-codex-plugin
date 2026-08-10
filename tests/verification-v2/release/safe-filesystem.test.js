'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const helper = path.resolve(
  __dirname,
  '../../../plugins/specnav-operations/scripts/safe-filesystem.py'
);

function waitFor(file, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(file)) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`timed out waiting for ${file}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function runPaused(request, ready, proceed) {
  return childProcess.spawn('python3', [helper], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SPECNAV_SAFE_FS_TEST_MODE: '1',
      SPECNAV_SAFE_FS_TEST_READY: ready,
      SPECNAV_SAFE_FS_TEST_CONTINUE: proceed
    }
  });
}

function collect(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve) => {
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function runRequest(request) {
  const child = childProcess.spawn('python3', [helper], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  });
  const result = collect(child);
  child.stdin.end(`${JSON.stringify(request)}\n`);
  return result;
}

test('descriptor-relative read rejects an ancestor swap without reading external bytes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-safe-read-'));
  const root = path.join(workspace, 'change');
  const moved = path.join(workspace, 'moved-change');
  const external = path.join(workspace, 'external');
  const ready = path.join(workspace, 'ready');
  const proceed = path.join(workspace, 'continue');
  fs.mkdirSync(path.join(root, 'verify'), { recursive: true });
  fs.mkdirSync(path.join(external, 'verify'), { recursive: true });
  fs.writeFileSync(path.join(root, 'verify', 'artifact.json'), '{"trusted":true}\n');
  fs.writeFileSync(path.join(external, 'verify', 'artifact.json'), '{"secret":true}\n');

  const child = runPaused({}, ready, proceed);
  const resultPromise = collect(child);
  child.stdin.end(`${JSON.stringify({
    action: 'read_file',
    root,
    relative: 'verify/artifact.json',
    blocker_id: 'verification-release:test-read'
  })}\n`);
  await waitFor(ready);
  fs.renameSync(root, moved);
  fs.symlinkSync(external, root, 'dir');
  fs.writeFileSync(proceed, 'continue\n');

  const result = await resultPromise;
  assert.equal(result.status, 2, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'verification-release:test-read:root-changed');
  assert.doesNotMatch(result.stdout, /secret/);
});

test('descriptor-relative tree copy rejects a source swap and deletes the partial backup', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-safe-copy-'));
  const source = path.join(workspace, 'change');
  const moved = path.join(workspace, 'moved-change');
  const external = path.join(workspace, 'external');
  const target = path.join(workspace, 'target');
  const ready = path.join(workspace, 'ready');
  const proceed = path.join(workspace, 'continue');
  fs.mkdirSync(source);
  fs.mkdirSync(external);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, 'artifact.json'), '{"trusted":true}\n');
  fs.writeFileSync(path.join(external, 'artifact.json'), '{"secret":true}\n');

  const child = runPaused({}, ready, proceed);
  const resultPromise = collect(child);
  child.stdin.end(`${JSON.stringify({
    action: 'copy_tree',
    source_root: source,
    source_relative: '.',
    target_root: target,
    target_relative: 'backup',
    blocker_id: 'verification-operations:test-copy'
  })}\n`);
  await waitFor(ready);
  fs.renameSync(source, moved);
  fs.symlinkSync(external, source, 'dir');
  fs.writeFileSync(proceed, 'continue\n');

  const result = await resultPromise;
  assert.equal(result.status, 2, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'verification-operations:test-copy:root-changed');
  assert.equal(fs.existsSync(path.join(target, 'backup')), false);
});

test('archive lock acquisition has one atomic winner and owner-bound release', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-safe-lock-'));
  fs.mkdirSync(path.join(root, 'openspec', '.specnav'), { recursive: true });
  const relative = 'openspec/.specnav/archive.lock';
  const blocker = 'verification-operations:test-lock';
  const first = runRequest({
    action: 'create_lock',
    root,
    relative,
    token: 'owner-first',
    blocker_id: blocker
  });
  const second = runRequest({
    action: 'create_lock',
    root,
    relative,
    token: 'owner-second',
    blocker_id: blocker
  });
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((entry) => entry.status).sort(),
    [0, 2]
  );
  const winner = JSON.parse(results.find((entry) => entry.status === 0).stdout);
  const loser = JSON.parse(results.find((entry) => entry.status === 2).stdout);
  assert.equal(winner.acquired, true);
  assert.equal(loser.error, `${blocker}:exists`);
  const owner = fs.readFileSync(
    path.join(root, relative, 'owner'),
    'utf8'
  ).trim();

  const wrongRelease = await runRequest({
    action: 'release_lock',
    root,
    relative,
    token: owner === 'owner-first' ? 'owner-second' : 'owner-first',
    blocker_id: blocker
  });
  assert.equal(wrongRelease.status, 2);
  assert.equal(
    JSON.parse(wrongRelease.stdout).error,
    `${blocker}:owner-mismatch`
  );
  assert.equal(fs.existsSync(path.join(root, relative)), true);

  const release = await runRequest({
    action: 'release_lock',
    root,
    relative,
    token: owner,
    blocker_id: blocker
  });
  assert.equal(release.status, 0, release.stderr);
  assert.equal(JSON.parse(release.stdout).released, true);
  assert.equal(fs.existsSync(path.join(root, relative)), false);
});

test('atomic write compare-and-swap rejects a stale expected value', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-safe-cas-'));
  const target = path.join(root, 'operations', 'host-proof-current.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const initial = Buffer.from('{"generation":1}\n');
  const concurrent = Buffer.from('{"generation":2}\n');
  const stale = Buffer.from('{"generation":3}\n');
  fs.writeFileSync(target, initial);
  fs.writeFileSync(target, concurrent);

  const result = await runRequest({
    action: 'atomic_write',
    root,
    relative: 'operations/host-proof-current.json',
    blocker_id: 'verification-host-artifacts:test-cas',
    data_base64: stale.toString('base64'),
    expected_exists: true,
    expected_base64: initial.toString('base64')
  });

  assert.equal(result.status, 2, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).error,
    'verification-host-artifacts:test-cas:changed-during-write'
  );
  assert.deepEqual(fs.readFileSync(target), concurrent);
});

test('safe filesystem ignores an environment-selected Python executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-safe-python-'));
  const target = path.join(root, 'artifact.json');
  const fakePython = path.join(root, 'fake-python');
  const marker = path.join(root, 'fake-python-ran');
  const modulePath = path.resolve(
    __dirname,
    '../../../plugins/specnav-operations/scripts/safe-filesystem.js'
  );
  fs.writeFileSync(target, '{"trusted":true}\n');
  fs.writeFileSync(
    fakePython,
    `#!/bin/sh\nprintf 'ran\\n' > ${JSON.stringify(marker)}\nprintf '%s\\n' '{"ok":true,"exists":true,"data_base64":"Zm9yZ2Vk"}'\n`
  );
  fs.chmodSync(fakePython, 0o755);

  const result = childProcess.spawnSync(process.execPath, [
    '-e',
    [
      'const safeFs = require(process.argv[1]);',
      'const bytes = safeFs.readRegularFile(',
      '  process.argv[2], process.argv[3], "verification-release:test"',
      ');',
      'process.stdout.write(bytes);'
    ].join('\n'),
    modulePath,
    root,
    target
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECNAV_PYTHON_BIN: fakePython
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{"trusted":true}\n');
  assert.equal(fs.existsSync(marker), false);
});
