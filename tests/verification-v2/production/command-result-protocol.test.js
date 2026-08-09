'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const PROTOCOL = path.join(
  ROOT,
  'tests/verification-v2/command-result-protocol.sh'
);

test('only the top-level command owns the assertion result file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-protocol-'));
  const resultFile = path.join(root, 'assertions.jsonl');
  const child = path.join(root, 'child.sh');
  const parent = path.join(root, 'parent.sh');
  fs.writeFileSync(child, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `source ${JSON.stringify(PROTOCOL)}`,
    'trap \'status=$?; specnav_verification_emit_assertions "$status"; exit "$status"\' EXIT',
    'exit 0',
    ''
  ].join('\n'));
  fs.writeFileSync(parent, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `source ${JSON.stringify(PROTOCOL)}`,
    'trap \'status=$?; specnav_verification_emit_assertions "$status"; exit "$status"\' EXIT',
    `bash ${JSON.stringify(child)}`,
    'exit 0',
    ''
  ].join('\n'));
  fs.chmodSync(child, 0o700);
  fs.chmodSync(parent, 0o700);

  const execution = childProcess.spawnSync('bash', [parent], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECNAV_VERIFICATION_ASSERTION_IDS: 'ASSERT-01,ASSERT-02',
      SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: resultFile
    }
  });

  assert.equal(execution.status, 0, execution.stderr);
  const records = fs.readFileSync(resultFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(records.map((entry) => entry.assertion_id), [
    'ASSERT-01',
    'ASSERT-02'
  ]);
  assert.ok(records.every((entry) => entry.status === 'passed'));
});

test('the top-level command emits immutable assertion results only once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-protocol-once-'));
  const resultFile = path.join(root, 'assertions.jsonl');
  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `source ${JSON.stringify(PROTOCOL)}`,
    'specnav_verification_emit_assertions 0',
    'specnav_verification_emit_assertions 0',
    ''
  ].join('\n'));
  fs.chmodSync(runner, 0o700);

  const execution = childProcess.spawnSync('bash', [runner], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECNAV_VERIFICATION_ASSERTION_IDS: 'ASSERT-01,ASSERT-02',
      SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: resultFile
    }
  });

  assert.equal(execution.status, 0, execution.stderr);
  const records = fs.readFileSync(resultFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((entry) => entry.assertion_id), [
    'ASSERT-01',
    'ASSERT-02'
  ]);
});

test('a bash subshell cannot emit for its parent protocol owner', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-protocol-subshell-'));
  const resultFile = path.join(root, 'assertions.jsonl');
  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `source ${JSON.stringify(PROTOCOL)}`,
    '(specnav_verification_emit_assertions 1)',
    'specnav_verification_emit_assertions 0',
    ''
  ].join('\n'));
  fs.chmodSync(runner, 0o700);

  const execution = childProcess.spawnSync('bash', [runner], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECNAV_VERIFICATION_ASSERTION_IDS: 'ASSERT-01',
      SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: resultFile
    }
  });

  assert.equal(execution.status, 0, execution.stderr);
  const records = fs.readFileSync(resultFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(records, [{
    assertion_id: 'ASSERT-01',
    method: 'equal',
    expected: true,
    actual: true,
    status: 'passed'
  }]);
});
