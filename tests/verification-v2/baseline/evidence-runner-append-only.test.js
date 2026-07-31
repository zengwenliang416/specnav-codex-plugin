'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
process.env.SPECNAV_CORE_ROOT = path.join(ROOT, 'plugins/specnav-core');

const { runEvidence } = require(path.join(
  ROOT,
  'plugins/specnav-verification/scripts/evidence-runner'
));

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
  const first = runEvidence(project, { change: 'verification-2-0' });
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
  const second = runEvidence(project, { change: 'verification-2-0' });
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
});
