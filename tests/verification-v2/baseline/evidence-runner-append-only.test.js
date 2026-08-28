'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
process.env.SPECNAV_CORE_ROOT = path.join(ROOT, 'plugins/specnav-core');

const { replayValidationLog } = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/evidence-runner'
));
const {
  createValidationReceiptAuthority
} = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/development-receipt-authority'
));
const RECEIPT_AUTHORITY = createValidationReceiptAuthority({
  key: Buffer.alloc(32, 23),
  authorityDigest: 'c'.repeat(64)
});

function appendClaim(logFile, command) {
  fs.appendFileSync(logFile, `${JSON.stringify({
    task_id: '001-baseline-fake-green',
    command,
    status: 'claimed',
    ok: true,
    replayable: true
  })}\n`);
}

test('evidence runner never overwrites a prior system-executed log', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-evidence-runner-'));
  const development = path.join(
    project,
    'openspec/changes/verification-2-0/development'
  );
  const validationLog = path.join(development, 'validation-log.jsonl');

  fs.mkdirSync(development, { recursive: true });
  fs.writeFileSync(validationLog, '');

  appendClaim(validationLog, 'printf first-evidence');
  const first = replayValidationLog(project, {
    change: 'verification-2-0',
    receiptAuthority: RECEIPT_AUTHORITY
  });
  assert.equal(first.ok, true);
  assert.equal(first.replayed, 1);

  const firstPath = path.join(
    project,
    'openspec/changes/verification-2-0',
    first.results[0].evidence_log
  );
  const firstContent = fs.readFileSync(firstPath, 'utf8');
  assert.match(firstContent, /first-evidence/);

  appendClaim(validationLog, 'printf second-evidence');
  const second = replayValidationLog(project, {
    change: 'verification-2-0',
    receiptAuthority: RECEIPT_AUTHORITY
  });
  assert.equal(second.ok, true);
  assert.equal(second.replayed, 1);
  assert.notEqual(second.results[0].evidence_log, first.results[0].evidence_log);
  assert.equal(fs.readFileSync(firstPath, 'utf8'), firstContent);

  const secondPath = path.join(
    project,
    'openspec/changes/verification-2-0',
    second.results[0].evidence_log
  );
  assert.match(fs.readFileSync(secondPath, 'utf8'), /second-evidence/);
  assert.equal(RECEIPT_AUTHORITY.verify(first.results[0]), true);
  assert.equal(RECEIPT_AUTHORITY.verify(second.results[0]), true);
});

test('legacy replay reruns a signed failure instead of returning a false green', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-evidence-failure-'));
  const development = path.join(
    project,
    'openspec/changes/verification-2-0/development'
  );
  const validationLog = path.join(development, 'validation-log.jsonl');

  try {
    fs.mkdirSync(development, { recursive: true });
    fs.writeFileSync(validationLog, '');
    appendClaim(validationLog, 'exit 1');

    const first = replayValidationLog(project, {
      change: 'verification-2-0',
      receiptAuthority: RECEIPT_AUTHORITY
    });
    assert.equal(first.ok, false);
    assert.equal(first.replayed, 1);
    assert.equal(first.failed, 1);

    const second = replayValidationLog(project, {
      change: 'verification-2-0',
      receiptAuthority: RECEIPT_AUTHORITY
    });
    assert.equal(second.ok, false);
    assert.equal(second.replayed, 1);
    assert.equal(second.failed, 1);
    assert.notEqual(
      second.results[0].receipt_id,
      first.results[0].receipt_id
    );
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
