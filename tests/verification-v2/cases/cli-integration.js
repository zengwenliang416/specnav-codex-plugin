'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ROOT,
  reviewer,
  sampleCase,
  sources
} = require('./test-helpers');

const CLI = path.join(
  ROOT,
  'plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js'
);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-case-contract-'));

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env
    }
  });
}

function resultOf(execution) {
  assert.equal(
    execution.stdout.trim().startsWith('{'),
    true,
    `expected JSON output\nstdout:\n${execution.stdout}\nstderr:\n${execution.stderr}`
  );
  return JSON.parse(execution.stdout);
}

try {
  const requestPath = path.join(sandbox, 'request.json');
  const snapshotPath = path.join(sandbox, 'snapshot.json');
  const requirementsPath = path.join(sandbox, 'requirements.json');
  const acceptancePath = path.join(sandbox, 'acceptance.json');
  fs.writeFileSync(
    requirementsPath,
    `${JSON.stringify(sources().requirements, null, 2)}\n`
  );
  fs.writeFileSync(
    acceptancePath,
    `${JSON.stringify(sources().acceptance, null, 2)}\n`
  );
  fs.writeFileSync(requestPath, `${JSON.stringify({
    changeId: 'verification-2-0',
    ...sources(),
    cases: [sampleCase()],
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  }, null, 2)}\n`);

  const snapshotRun = run([
    'snapshot',
    '--input',
    requestPath,
    '--output',
    snapshotPath,
    '--json'
  ]);
  assert.equal(
    snapshotRun.status,
    0,
    `snapshot failed\nstdout:\n${snapshotRun.stdout}\nstderr:\n${snapshotRun.stderr}`
  );
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const approvalPath = path.join(sandbox, 'approval.json');
  fs.writeFileSync(approvalPath, `${JSON.stringify({
    schema: 'specnav.verification.case-approval.v1',
    id: 'approval-cli',
    change_id: snapshot.change_id,
    snapshot_id: snapshot.id,
    snapshot_hash: snapshot.snapshot_hash,
    decision: 'approved',
    reviewer: reviewer(),
    decided_at: '2026-07-31T00:01:00Z'
  }, null, 2)}\n`);

  const checkRun = run([
    'check',
    '--snapshot',
    snapshotPath,
    '--approval',
    approvalPath,
    '--requirements',
    requirementsPath,
    '--acceptance',
    acceptancePath,
    '--reviewer-id',
    'reviewer-1',
    '--json'
  ]);
  assert.equal(
    checkRun.status,
    0,
    `check failed\nstdout:\n${checkRun.stdout}\nstderr:\n${checkRun.stderr}`
  );
  const result = JSON.parse(checkRun.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.execution_allowed, true);

  const changed = structuredClone(snapshot);
  changed.cases[0].title = 'Stale approval';
  fs.writeFileSync(snapshotPath, `${JSON.stringify(changed, null, 2)}\n`);
  const staleRun = run([
    'check',
    '--snapshot',
    snapshotPath,
    '--approval',
    approvalPath,
    '--requirements',
    requirementsPath,
    '--acceptance',
    acceptancePath,
    '--reviewer-id',
    'reviewer-1',
    '--json'
  ]);
  assert.equal(staleRun.status, 2);
  const stale = JSON.parse(staleRun.stdout);
  assert.equal(
    stale.blockers.some((entry) => entry.id === 'verification-cases:snapshot-stale'),
    true
  );

  const unavailableRuntime = path.join(sandbox, 'runtime-unavailable');
  const invalidEnvironment = {
    SPECNAV_VERIFICATION_RUNTIME_ROOT: unavailableRuntime
  };
  const unsupported = run(['unknown', '--json'], {
    env: invalidEnvironment
  });
  assert.equal(unsupported.status, 2);
  assert.equal(
    resultOf(unsupported).blockers[0].id,
    'verification-cases:unsupported-action:unknown'
  );

  const missingInput = run([
    'snapshot',
    '--output',
    path.join(sandbox, 'unused.json'),
    '--json'
  ], {
    env: invalidEnvironment
  });
  assert.equal(missingInput.status, 2);
  assert.equal(
    resultOf(missingInput).blockers[0].id,
    'verification-cases:snapshot-input-invalid'
  );

  const malformedPath = path.join(sandbox, 'malformed.json');
  fs.writeFileSync(malformedPath, '{invalid-json\n');
  const malformed = run([
    'snapshot',
    '--input',
    malformedPath,
    '--output',
    path.join(sandbox, 'unused.json'),
    '--json'
  ], {
    env: invalidEnvironment
  });
  assert.equal(malformed.status, 2);
  assert.match(
    resultOf(malformed).blockers[0].id,
    /^verification-cases:snapshot-input-invalid:/
  );

  const runtimeNotReady = run([
    'snapshot',
    '--input',
    requestPath,
    '--output',
    path.join(sandbox, 'runtime-blocked.json'),
    '--json'
  ], {
    env: invalidEnvironment
  });
  assert.equal(runtimeNotReady.status, 2);
  assert.equal(
    resultOf(runtimeNotReady).blockers[0].id,
    'verification-cases:runtime-not-ready'
  );

  const existingPath = path.join(sandbox, 'existing-snapshot.json');
  const sentinel = Buffer.from('immutable-existing-snapshot\n');
  fs.writeFileSync(existingPath, sentinel);
  const blockedWrite = run([
    'snapshot',
    '--input',
    requestPath,
    '--output',
    existingPath,
    '--json'
  ]);
  assert.equal(blockedWrite.status, 2);
  assert.equal(
    resultOf(blockedWrite).blockers[0].id,
    'verification-cases:output-exists'
  );
  assert.deepEqual(fs.readFileSync(existingPath), sentinel);
  assert.deepEqual(
    fs.readdirSync(sandbox).filter((name) => name.includes('.tmp-')),
    []
  );

  const blockedRequestPath = path.join(sandbox, 'blocked-request.json');
  fs.writeFileSync(blockedRequestPath, `${JSON.stringify({
    changeId: 'verification-2-0',
    ...sources(),
    cases: [],
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: reviewer()
  }, null, 2)}\n`);
  const blockedPlan = run([
    'snapshot',
    '--input',
    blockedRequestPath,
    '--output',
    existingPath,
    '--json'
  ]);
  assert.equal(blockedPlan.status, 2);
  assert.equal(
    resultOf(blockedPlan).blockers.some((entry) => (
      entry.id === 'verification-cases:plan-blocked'
    )),
    true
  );
  assert.deepEqual(fs.readFileSync(existingPath), sentinel);

  const missingCheckInput = run(['check', '--json'], {
    env: invalidEnvironment
  });
  assert.equal(missingCheckInput.status, 2);
  assert.equal(
    resultOf(missingCheckInput).blockers[0].id,
    'verification-cases:snapshot-invalid'
  );

  const missingOutput = run([
    'snapshot',
    '--input',
    requestPath,
    '--json'
  ], {
    env: invalidEnvironment
  });
  assert.equal(missingOutput.status, 2);
  assert.equal(
    resultOf(missingOutput).blockers[0].id,
    'verification-cases:output-missing'
  );

  const nullSnapshotPath = path.join(sandbox, 'null-snapshot.json');
  fs.writeFileSync(nullSnapshotPath, 'null\n');
  const nullSnapshot = run([
    'check',
    '--snapshot',
    nullSnapshotPath,
    '--approval',
    approvalPath,
    '--requirements',
    requirementsPath,
    '--acceptance',
    acceptancePath,
    '--reviewer-id',
    'reviewer-1',
    '--json'
  ]);
  assert.equal(nullSnapshot.status, 2);
  assert.equal(
    resultOf(nullSnapshot).blockers.some((entry) => (
      entry.id === 'verification-cases:snapshot-missing'
    )),
    true
  );

  process.stdout.write('verification v2 case approval cli ok\n');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
