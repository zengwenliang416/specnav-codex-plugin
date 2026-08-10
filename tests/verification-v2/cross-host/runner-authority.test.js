'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PROOF_FILES
} = require('../../../integrations/sync-operations-proof');
const {
  hostProofRunnerSourceDigest
} = require(
  '../../../plugins/specnav-operations/scripts/verification-v2-host-contract'
);

const RUNNER_SOURCE_SHA256 = 'a'.repeat(64);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function synchronizedFixture(t, layout) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-runner-authority-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const operationsRoot = path.join(root, layout, 'specnav-operations');
  const files = PROOF_FILES.map((relative) => {
    const bytes = Buffer.from(`synchronized:${relative}\n`);
    const file = path.join(operationsRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return {
      path: relative,
      sha256: sha256(bytes)
    };
  });
  const manifestFile = path.join(
    operationsRoot,
    'specnav-verification-proof-source.json'
  );
  const manifest = {
    schema: 'specnav.operations.verification-proof-sync.v1',
    generated: true,
    generated_at: '2026-08-10T00:00:00Z',
    host: layout === 'plugins' ? 'claude-code' : 'codefree-o',
    source_repository: 'specnav-codex-plugin',
    source_commit: 'b'.repeat(40),
    source_dirty: false,
    runner_source_sha256: RUNNER_SOURCE_SHA256,
    files
  };
  writeJson(manifestFile, manifest);
  return { manifest, manifestFile, operationsRoot, root };
}

for (const layout of ['plugins', 'modules']) {
  test(`synchronized ${layout} authority returns the declared digest`, (t) => {
    const fixture = synchronizedFixture(t, layout);

    assert.equal(
      hostProofRunnerSourceDigest(fixture.root),
      RUNNER_SOURCE_SHA256
    );
  });
}

test('missing runner authority blocks', (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-runner-authority-missing-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => hostProofRunnerSourceDigest(root),
    /verification-host-contract:runner-authority-invalid/
  );
});

test('ambiguous synchronized runner authority blocks', (t) => {
  const fixture = synchronizedFixture(t, 'plugins');
  const moduleRoot = path.join(
    fixture.root,
    'modules',
    'specnav-operations'
  );
  fs.cpSync(fixture.operationsRoot, moduleRoot, { recursive: true });

  assert.throws(
    () => hostProofRunnerSourceDigest(fixture.root),
    /verification-host-contract:runner-authority-invalid/
  );
});

test('canonical and synchronized runner authority cannot coexist', (t) => {
  const fixture = synchronizedFixture(t, 'plugins');
  writeJson(
    path.join(fixture.root, '.agents/plugins/marketplace.json'),
    { name: 'canonical-marker' }
  );

  assert.throws(
    () => hostProofRunnerSourceDigest(fixture.root),
    /verification-host-contract:runner-authority-invalid/
  );
});

test('tampered synchronized manifest blocks', (t) => {
  const fixture = synchronizedFixture(t, 'plugins');
  writeJson(fixture.manifestFile, {
    ...fixture.manifest,
    source_dirty: true
  });

  assert.throws(
    () => hostProofRunnerSourceDigest(fixture.root),
    /verification-host-contract:runner-authority-invalid/
  );
});

test('tampered synchronized proof file blocks', (t) => {
  const fixture = synchronizedFixture(t, 'modules');
  fs.appendFileSync(
    path.join(
      fixture.operationsRoot,
      'scripts/verification-v2-host-contract.js'
    ),
    'tampered\n'
  );

  assert.throws(
    () => hostProofRunnerSourceDigest(fixture.root),
    /verification-host-contract:runner-authority-invalid/
  );
});
