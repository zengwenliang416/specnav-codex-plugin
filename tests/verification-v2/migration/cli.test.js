'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  cleanup,
  legacyReading,
  makeSandbox,
  writeLegacy
} = require('./test-helpers');

const CLI = path.resolve(
  __dirname,
  '../../../plugins/specnav-verification/scripts/verification-migrate.js'
);

test('CLI requires an explicit mode and request file', () => {
  const subject = require(CLI);

  assert.equal(subject.run([]).ok, false);
  assert.equal(subject.run(['dry-run']).ok, false);
  assert.equal(spawnSync(process.execPath, [CLI], {
    encoding: 'utf8'
  }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, 'dry-run'], {
    encoding: 'utf8'
  }).status, 2);
});

test('CLI dry-run, apply, and rollback use the same Kernel migrator', (t) => {
  const sandbox = makeSandbox('specnav-migration-cli-');
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  const evidenceRoot = path.join(sandbox.changeRoot, 'verify', 'evidence');
  const sourceRoot = path.join(sandbox.projectRoot, 'evidence-source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const requestFile = path.join(sandbox.projectRoot, 'request.json');
  const request = {
    change_root: sandbox.changeRoot,
    change_id: 'change-v2',
    migration_id: 'migration-cli',
    artifacts: [{ path: 'verify-v1/static.json' }],
    integrity: {
      evidence_store_root: evidenceRoot,
      source_root: sourceRoot,
      registered_producers: ['command-runner']
    }
  };
  fs.writeFileSync(requestFile, `${JSON.stringify(request, null, 2)}\n`);

  const subject = require(CLI);
  const dryRun = subject.run(['dry-run', '--request', requestFile]);
  assert.equal(dryRun.ok, true, JSON.stringify(dryRun.blockers));
  assert.equal(dryRun.receipt.mode, 'dry_run');

  const applied = subject.run(['apply', '--request', requestFile]);
  assert.equal(applied.ok, true, JSON.stringify(applied.blockers));
  assert.equal(applied.receipt.mode, 'apply');

  request.receipt_path =
    'verify/migration/receipts/migration-cli.json';
  delete request.artifacts;
  delete request.integrity;
  fs.writeFileSync(requestFile, `${JSON.stringify(request, null, 2)}\n`);
  const rolledBack = subject.run([
    'rollback',
    '--request',
    requestFile
  ]);
  assert.equal(rolledBack.ok, true, JSON.stringify(rolledBack.blockers));
  assert.equal(rolledBack.receipt.mode, 'rollback');
});

test('CLI invokes the real integrity checker for a legacy green reading', (t) => {
  const sandbox = makeSandbox('specnav-migration-cli-integrity-');
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/green.json',
    legacyReading({
      verdict: 'green',
      evidence_request: {
        activeChangeId: 'change-v2',
        caseSnapshot: null,
        run: null,
        attempts: [],
        readings: [],
        evidence: [],
        currentFingerprints: {}
      }
    })
  );
  const sourceRoot = path.join(sandbox.projectRoot, 'evidence-source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const requestFile = path.join(sandbox.projectRoot, 'request.json');
  fs.writeFileSync(requestFile, `${JSON.stringify({
    change_root: sandbox.changeRoot,
    change_id: 'change-v2',
    migration_id: 'migration-live-integrity',
    artifacts: [{ path: 'verify-v1/green.json' }],
    integrity: {
      evidence_store_root: path.join(
        sandbox.changeRoot,
        'verify',
        'evidence'
      ),
      source_root: sourceRoot,
      registered_producers: ['command-runner']
    }
  }, null, 2)}\n`);

  const result = require(CLI).run([
    'dry-run',
    '--request',
    requestFile
  ]);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.preview[0].reading.verdict, 'blocked');
  assert.equal(result.preview[0].requires_rerun, true);
  assert.equal(result.preview[0].evidence_blockers.length > 0, true);
  assert.match(
    result.preview[0].evidence_blockers[0].id,
    /^verification-(?:integrity|contract):/
  );
});
