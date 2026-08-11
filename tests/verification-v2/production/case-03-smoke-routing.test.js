'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const SMOKE = path.join(ROOT, 'tests', 'run-smoke.sh');
const CASE_RUNNER = path.join(
  ROOT,
  'tests',
  'run-verification-v2-case-03.sh'
);
const CASE_ASSERTIONS = 'CASE-03-A01,CASE-03-A02,CASE-03-A03';
const FULL_SUITES = [
  'run-codex-marketplace-fixtures.sh',
  'run-codex-plugin-fixtures.sh',
  'run-codex-skill-fixtures.sh',
  'run-codex-hook-fixtures.sh',
  'run-codex-development-fixtures.sh',
  'run-plugin-suite-resolver-fixtures.sh',
  'run-task-checkbox-contract-fixtures.sh',
  'run-lane-routing-fixtures.sh',
  'run-operations-archive-action-fixtures.sh',
  'run-codegraph-policy-fixtures.sh',
  'run-codegraph-context-fixtures.sh',
  'run-light-compact-gate-fixtures.sh',
  'run-verification-v2-cross-host.sh',
  'run-verification-v2-release.sh'
];

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-smoke-route-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'bash.log');
  const assertionFile = path.join(root, 'assertions.jsonl');
  fs.mkdirSync(bin);
  const fakeBash = path.join(bin, 'bash');
  fs.writeFileSync(fakeBash, [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >>"$SPECNAV_SMOKE_TEST_LOG"',
    'case "$*" in',
    '  *"$SPECNAV_SMOKE_FAKE_FAIL"*) exit 17 ;;',
    'esac',
    'exit 0',
    ''
  ].join('\n'));
  fs.chmodSync(fakeBash, 0o755);
  return {
    root,
    log,
    assertionFile,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SPECNAV_SMOKE_TEST_LOG: log,
      SPECNAV_SMOKE_FAKE_FAIL: '__never__',
      SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_EMITTED: '0',
      SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_OWNER_PID: '',
      SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: ''
    }
  };
}

function runSmoke(env) {
  return spawnSync('/bin/bash', [SMOKE], {
    cwd: ROOT,
    env,
    encoding: 'utf8'
  });
}

function calls(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
}

function assertionRecords(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('routes the exact approved CASE-03 assertion set to its dedicated runner', () => {
  const fixture = harness();
  const result = runSmoke({
    ...fixture.env,
    SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: fixture.assertionFile,
    SPECNAV_VERIFICATION_ASSERTION_IDS: CASE_ASSERTIONS
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(fixture.log), [CASE_RUNNER]);
  assert.match(result.stdout, /specnav codex CASE-03 smoke ok/);
  assert.deepEqual(
    assertionRecords(fixture.assertionFile).map((record) => ({
      assertion_id: record.assertion_id,
      actual: record.actual,
      status: record.status
    })),
    [
      { assertion_id: 'CASE-03-A01', actual: true, status: 'passed' },
      { assertion_id: 'CASE-03-A02', actual: true, status: 'passed' },
      { assertion_id: 'CASE-03-A03', actual: true, status: 'passed' }
    ]
  );
});

test('keeps the complete smoke suite as the default path', () => {
  const fixture = harness();
  const result = runSmoke({
    ...fixture.env,
    SPECNAV_VERIFICATION_ASSERTION_IDS: ''
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    calls(fixture.log).map((entry) => path.basename(entry)),
    FULL_SUITES
  );
  assert.match(result.stdout, /specnav codex smoke ok/);
});

for (const [label, assertionIds] of [
  ['reordered', 'CASE-03-A03,CASE-03-A02,CASE-03-A01'],
  ['single', 'CASE-03-A01'],
  ['partial', 'CASE-03-A01,CASE-03-A02'],
  ['extra', `${CASE_ASSERTIONS},CASE-03-A04`],
  ['duplicate', 'CASE-03-A01,CASE-03-A02,CASE-03-A03,CASE-03-A03']
]) {
  test(`does not route ${label} assertion identities`, () => {
    const fixture = harness();
    const result = runSmoke({
      ...fixture.env,
      SPECNAV_VERIFICATION_ASSERTION_IDS: assertionIds
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      calls(fixture.log).map((entry) => path.basename(entry)),
      FULL_SUITES
    );
  });
}

test('propagates a dedicated CASE-03 runner failure without fallback', () => {
  const fixture = harness();
  const result = runSmoke({
    ...fixture.env,
    SPECNAV_SMOKE_FAKE_FAIL: 'run-verification-v2-case-03.sh',
    SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: fixture.assertionFile,
    SPECNAV_VERIFICATION_ASSERTION_IDS: CASE_ASSERTIONS
  });

  assert.equal(result.status, 17);
  assert.deepEqual(calls(fixture.log), [CASE_RUNNER]);
  assert.doesNotMatch(result.stdout, /specnav codex smoke ok/);
  assert.deepEqual(
    assertionRecords(fixture.assertionFile).map((record) => ({
      assertion_id: record.assertion_id,
      actual: record.actual,
      status: record.status
    })),
    [
      { assertion_id: 'CASE-03-A01', actual: false, status: 'failed' },
      { assertion_id: 'CASE-03-A02', actual: false, status: 'failed' },
      { assertion_id: 'CASE-03-A03', actual: false, status: 'failed' }
    ]
  );
});
