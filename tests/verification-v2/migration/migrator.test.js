'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  brokenEvidenceResult,
  cleanup,
  createMigrator,
  fakeSchemaRegistry,
  intactEvidenceResult,
  integrityChecker,
  legacyReading,
  makeSandbox,
  migrationRequest,
  readJson,
  readJsonl,
  sha256,
  writeLegacy
} = require('./test-helpers');

test('dry-run plans migration without writing any file', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  const before = fs.readdirSync(sandbox.changeRoot, { recursive: true });

  const result = createMigrator().migrate(migrationRequest(sandbox));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.receipt.mode, 'dry_run');
  assert.equal(result.receipt.status, 'planned');
  assert.deepEqual(
    fs.readdirSync(sandbox.changeRoot, { recursive: true }),
    before
  );
});

test('apply creates an exact backup, V2 projection, and validated receipt', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  const source = writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  const migrator = createMigrator();

  const result = migrator.migrate(migrationRequest(sandbox, {
    mode: 'apply'
  }));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.receipt.status, 'succeeded');
  assert.equal(result.receipt.validation.ok, true);
  assert.equal(result.receipt.rollback.available, true);
  assert.deepEqual(fs.readFileSync(source.file), source.bytes);

  const backupManifest = readJson(path.join(
    sandbox.changeRoot,
    result.receipt.backup_ref.path
  ));
  const backupFile = path.join(
    sandbox.changeRoot,
    backupManifest.artifacts[0].backup.path
  );
  assert.deepEqual(fs.readFileSync(backupFile), source.bytes);

  const projection = readJsonl(path.join(
    sandbox.changeRoot,
    result.receipt.transformed_artifacts[0].path
  ));
  assert.equal(projection[0].source_verdict, 'fail');
  assert.equal(projection[0].reading.verdict, 'fail');
  assert.equal(projection[0].source_ref.sha256, source.sha256);

  const persistedReceipt = readJson(path.join(
    sandbox.changeRoot,
    'verify/migration/receipts/migration-001.json'
  ));
  assert.deepEqual(persistedReceipt, result.receipt);
});

test('failed V1 bytes and verdict survive migration unchanged', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  const value = legacyReading({
    actual: { stderr: 'historical failure must remain visible' },
    verdict: 'red'
  });
  const source = writeLegacy(
    sandbox.changeRoot,
    'verify-v1/failure.json',
    value
  );

  const result = createMigrator().migrate(migrationRequest(sandbox, {
    mode: 'apply',
    artifacts: [{ path: 'verify-v1/failure.json' }]
  }));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  const entry = readJsonl(path.join(
    sandbox.changeRoot,
    result.receipt.transformed_artifacts[0].path
  ))[0];
  assert.equal(entry.source_verdict, 'red');
  assert.equal(entry.reading.verdict, 'fail');
  assert.deepEqual(entry.reading.actual, value.actual);
  assert.equal(sha256(fs.readFileSync(source.file)), source.sha256);
});

test('legacy green without evidence becomes blocked and requires rerun', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading({ verdict: 'green' })
  );
  const checker = integrityChecker(brokenEvidenceResult());

  const result = createMigrator({
    integrityChecker: checker
  }).migrate(migrationRequest(sandbox));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(checker.calls.length, 0);
  assert.equal(result.preview[0].reading.verdict, 'blocked');
  assert.equal(result.preview[0].requires_rerun, true);
  assert.deepEqual(result.preview[0].blocker_ids, [
    'verification-migration:legacy-pass-unverified'
  ]);
});

test('legacy green remains pass only with intact and fresh evidence', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  const request = { graph: {}, currentFingerprints: {} };
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading({
      verdict: 'pass',
      evidence_ids: ['evidence-legacy'],
      evidence_request: request
    })
  );
  const checker = integrityChecker(intactEvidenceResult());

  const result = createMigrator({
    integrityChecker: checker
  }).migrate(migrationRequest(sandbox));

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.deepEqual(checker.calls, [{
    currentFingerprints: {}
  }]);
  assert.equal(result.preview[0].reading.verdict, 'pass');
  assert.equal(result.preview[0].requires_rerun, false);
  assert.deepEqual(result.preview[0].blocker_ids, []);
});

test('stale or broken evidence converts legacy green to blocked', (t) => {
  for (const evidenceResult of [
    brokenEvidenceResult('stale'),
    {
      ok: true,
      facts: {
        summary: {
          evidence_count: 1,
          integrity: 'intact',
          freshness: 'stale'
        },
        evidence: []
      },
      blockers: []
    }
  ]) {
    const sandbox = makeSandbox();
    t.after(() => cleanup(sandbox));
    writeLegacy(
      sandbox.changeRoot,
      'verify-v1/static.json',
      legacyReading({
        verdict: 'green',
        evidence_request: { graph: {}, currentFingerprints: {} }
      })
    );
    const result = createMigrator({
      integrityChecker: integrityChecker(evidenceResult)
    }).migrate(migrationRequest(sandbox));

    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.preview[0].reading.verdict, 'blocked');
    assert.equal(result.preview[0].requires_rerun, true);
  }
});

test('SQL and declared database artifacts are rejected', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  fs.mkdirSync(path.join(sandbox.changeRoot, 'verify-v1'), {
    recursive: true
  });
  fs.writeFileSync(
    path.join(sandbox.changeRoot, 'verify-v1/schema.sql'),
    'ALTER TABLE payroll ADD COLUMN salary integer;\n'
  );
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/database.json',
    legacyReading()
  );

  for (const artifacts of [
    [{ path: 'verify-v1/schema.sql' }],
    [{ path: 'verify-v1/database.json', kind: 'database' }]
  ]) {
    const result = createMigrator().migrate(migrationRequest(sandbox, {
      artifacts
    }));
    assert.equal(result.ok, false);
    assert.match(
      result.blockers[0].id,
      /^verification-migration:database-artifact-rejected/
    );
  }
});

test('missing change root and duplicate sources are rejected before writes', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );

  const missingRoot = createMigrator().migrate({
    ...migrationRequest(sandbox),
    change_root: undefined
  });
  assert.equal(missingRoot.ok, false);
  assert.equal(
    missingRoot.blockers[0].id,
    'verification-migration:change-root-invalid'
  );

  const duplicate = createMigrator().migrate(migrationRequest(sandbox, {
    mode: 'apply',
    artifacts: [
      { path: 'verify-v1/static.json' },
      { path: 'verify-v1/static.json' }
    ]
  }));
  assert.equal(duplicate.ok, false);
  assert.equal(
    duplicate.blockers[0].id,
    'verification-migration:duplicate-source'
  );
  assert.equal(
    fs.existsSync(path.join(sandbox.changeRoot, 'verify/migration')),
    false
  );
});

test('path traversal and symlink sources are rejected', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  const outside = path.join(sandbox.projectRoot, 'outside.json');
  fs.writeFileSync(outside, `${JSON.stringify(legacyReading())}\n`);
  fs.mkdirSync(path.join(sandbox.changeRoot, 'verify-v1'), {
    recursive: true
  });
  fs.symlinkSync(
    outside,
    path.join(sandbox.changeRoot, 'verify-v1/link.json')
  );

  for (const artifactPath of [
    '../outside.json',
    'verify-v1/link.json'
  ]) {
    const result = createMigrator().migrate(migrationRequest(sandbox, {
      artifacts: [{ path: artifactPath }]
    }));
    assert.equal(result.ok, false);
    assert.match(
      result.blockers[0].id,
      /^verification-migration:(?:source-path-unsafe|source-symlink)/
    );
  }
});

test('apply never overwrites an existing migration target', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  fs.mkdirSync(
    path.join(
      sandbox.changeRoot,
      'verify/migration/runs/migration-001'
    ),
    { recursive: true }
  );

  const result = createMigrator().migrate(migrationRequest(sandbox, {
    mode: 'apply'
  }));

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-migration:target-exists'
  );
});

test('rollback removes only this migration projection and retains backup and receipts', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  const migrator = createMigrator();
  const applied = migrator.migrate(migrationRequest(sandbox, {
    mode: 'apply'
  }));
  const applyReceipt = path.join(
    sandbox.changeRoot,
    'verify/migration/receipts/migration-001.json'
  );
  const projection = path.join(
    sandbox.changeRoot,
    applied.receipt.transformed_artifacts[0].path
  );
  const backup = path.join(
    sandbox.changeRoot,
    applied.receipt.backup_ref.path
  );

  const rolledBack = migrator.migrate(migrationRequest(sandbox, {
    mode: 'rollback',
    receipt_path: 'verify/migration/receipts/migration-001.json',
    artifacts: undefined
  }));

  assert.equal(rolledBack.ok, true, JSON.stringify(rolledBack.blockers));
  assert.equal(rolledBack.receipt.status, 'rolled_back');
  assert.equal(fs.existsSync(projection), false);
  assert.equal(fs.existsSync(backup), true);
  assert.equal(fs.existsSync(applyReceipt), true);
  assert.equal(
    fs.existsSync(path.join(
      sandbox.changeRoot,
      'verify/migration/receipts/migration-001-rollback.json'
    )),
    true
  );
});

test('rollback blocks when a transformed artifact was tampered with', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  const migrator = createMigrator();
  const applied = migrator.migrate(migrationRequest(sandbox, {
    mode: 'apply'
  }));
  const projection = path.join(
    sandbox.changeRoot,
    applied.receipt.transformed_artifacts[0].path
  );
  fs.appendFileSync(projection, '{"tampered":true}\n');

  const result = migrator.migrate(migrationRequest(sandbox, {
    mode: 'rollback',
    receipt_path: 'verify/migration/receipts/migration-001.json',
    artifacts: undefined
  }));

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-migration:rollback-artifact-mismatch'
  );
  assert.equal(fs.existsSync(projection), true);
});

test('rollback rejects a forged receipt that targets an arbitrary in-root file', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  const arbitrary = path.join(sandbox.changeRoot, 'README.md');
  fs.writeFileSync(arbitrary, 'must not be deleted\n');
  const receiptPath =
    'verify/migration/receipts/migration-forged.json';
  const receiptFile = path.join(sandbox.changeRoot, receiptPath);
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  fs.writeFileSync(receiptFile, `${JSON.stringify({
    schema: 'specnav.verification.migration-receipt.v1',
    id: 'migration-forged',
    change_id: 'change-v2',
    from_version: 'v1',
    to_version: 'v2',
    mode: 'apply',
    status: 'succeeded',
    started_at: '2026-08-02T00:00:00Z',
    completed_at: '2026-08-02T00:00:01Z',
    backup_ref: {
      id: 'arbitrary-backup',
      path: 'README.md',
      sha256: sha256(fs.readFileSync(arbitrary)),
      size: fs.statSync(arbitrary).size
    },
    transformed_artifacts: [{
      id: 'arbitrary-target',
      path: 'README.md',
      sha256: sha256(fs.readFileSync(arbitrary)),
      size: fs.statSync(arbitrary).size
    }],
    validation: {
      ok: true,
      validated_entities: [],
      blockers: []
    },
    rollback: {
      available: true,
      instructions: 'delete arbitrary file',
      receipt_ref: {
        id: 'migration-forged',
        path: receiptPath
      }
    },
    fallback_used: false
  }, null, 2)}\n`);

  const result = createMigrator().migrate(migrationRequest(sandbox, {
    mode: 'rollback',
    migration_id: 'migration-forged',
    receipt_path: receiptPath,
    artifacts: undefined
  }));

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-migration:rollback-provenance-invalid'
  );
  assert.equal(fs.readFileSync(arbitrary, 'utf8'), 'must not be deleted\n');
});

test('apply compensates all partial outputs when receipt creation fails', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  const originalOpen = fs.openSync;
  fs.openSync = function injectedOpen(file, ...args) {
    if (String(file).endsWith(
      'verify/migration/receipts/migration-001.json'
    )) {
      throw new Error('injected-receipt-write-failure');
    }
    return originalOpen.call(this, file, ...args);
  };
  t.after(() => {
    fs.openSync = originalOpen;
  });

  const result = createMigrator().migrate(migrationRequest(sandbox, {
    mode: 'apply'
  }));
  fs.openSync = originalOpen;

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-migration:apply-write-failed'
  );
  assert.equal(
    fs.existsSync(path.join(
      sandbox.changeRoot,
      'verify/migration/backups/migration-001'
    )),
    false
  );
  assert.equal(
    fs.existsSync(path.join(
      sandbox.changeRoot,
      'verify/migration/runs/migration-001'
    )),
    false
  );
});

test('rollback restores the projection when rollback receipt creation fails', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );
  const migrator = createMigrator();
  const applied = migrator.migrate(migrationRequest(sandbox, {
    mode: 'apply'
  }));
  const projection = path.join(
    sandbox.changeRoot,
    applied.receipt.transformed_artifacts[0].path
  );
  const before = fs.readFileSync(projection);
  const originalOpen = fs.openSync;
  fs.openSync = function injectedOpen(file, ...args) {
    if (String(file).endsWith(
      'verify/migration/receipts/migration-001-rollback.json'
    )) {
      throw new Error('injected-rollback-receipt-failure');
    }
    return originalOpen.call(this, file, ...args);
  };
  t.after(() => {
    fs.openSync = originalOpen;
  });

  const result = migrator.migrate(migrationRequest(sandbox, {
    mode: 'rollback',
    receipt_path: 'verify/migration/receipts/migration-001.json',
    artifacts: undefined
  }));
  fs.openSync = originalOpen;

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-migration:rollback-write-failed'
  );
  assert.deepEqual(fs.readFileSync(projection), before);
  assert.equal(
    fs.existsSync(path.join(
      sandbox.changeRoot,
      'verify/migration/receipts/migration-001-rollback.json'
    )),
    false
  );
});

test('schema-invalid receipts fail closed before apply writes', (t) => {
  const sandbox = makeSandbox();
  t.after(() => cleanup(sandbox));
  writeLegacy(
    sandbox.changeRoot,
    'verify-v1/static.json',
    legacyReading()
  );

  const result = createMigrator({
    schemaRegistry: fakeSchemaRegistry({ rejectReceipt: true })
  }).migrate(migrationRequest(sandbox, {
    mode: 'apply'
  }));

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-migration:receipt-schema-invalid'
  );
  assert.equal(
    fs.existsSync(path.join(sandbox.changeRoot, 'verify/migration')),
    false
  );
});
