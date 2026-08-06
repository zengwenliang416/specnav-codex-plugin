'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createHostAuthorityFixture,
  git,
  sha256
} = require('./host-authority-test-helpers');

function blockerIds(result) {
  return result.blockers.map((entry) => entry.id).sort();
}

function assertGreen(result) {
  assert.equal(result.ok, true, JSON.stringify(result.blockers, null, 2));
  assert.equal(result.comparison.ok, true);
  assert.deepEqual(Object.keys(result.snapshots).sort(), [
    'claude-code',
    'codefree-o',
    'codex'
  ]);
  assert.match(result.summary.digest, /^[a-f0-9]{64}$/);
}

test('packaged host provenance resolves without the source repository', (t) => {
  const isolatedRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-host-provenance-')
  );
  t.after(() => fs.rmSync(isolatedRoot, { recursive: true, force: true }));
  const pluginRoot = path.join(isolatedRoot, 'specnav-verification');
  fs.cpSync(
    path.resolve(__dirname, '../../../plugins/specnav-verification'),
    pluginRoot,
    { recursive: true }
  );
  const provenance = require(path.join(
    pluginRoot,
    'kernel/governance/host-provenance.js'
  ));

  const claude = provenance.createHostSyncPlan('claude-code');
  const codefree = provenance.createHostSyncPlan('codefree-o');

  for (const entry of claude.transformedFiles) {
    assert.equal(
      entry.source_sha256,
      sha256(fs.readFileSync(path.resolve(
        __dirname,
        '../../../plugins/specnav-verification',
        entry.source
      ))),
      entry.source
    );
  }
  assert.equal(
    claude.hostFiles.some((entry) => (
      entry.target === 'scripts/claude-verification-adapter.js'
    )),
    true
  );
  assert.equal(
    codefree.hostFiles.some((entry) => (
      entry.target === 'scripts/codefree-o-verification-adapter.js'
    )),
    true
  );
});

test('host authority validates clean repositories and fails closed on Git state', (t) => {
  const fixture = createHostAuthorityFixture(t);
  assertGreen(fixture.authority().resolve());

  const missing = fixture.authority({
    roots: { 'codefree-o': path.join(fixture.roots['codefree-o'], 'missing') }
  }).resolve();
  assert.equal(missing.ok, false);
  assert.deepEqual(blockerIds(missing), [
    'verification-release:host-root-missing:codefree-o'
  ]);
  assert.equal(missing.comparison, null);

  fs.writeFileSync(path.join(fixture.roots['claude-code'], 'head-only.txt'), 'x\n');
  git(fixture.roots['claude-code'], ['add', 'head-only.txt']);
  git(fixture.roots['claude-code'], ['commit', '-m', 'fixture: head mismatch']);
  const headMismatch = fixture.authority().resolve();
  assert.equal(headMismatch.ok, false);
  assert.deepEqual(blockerIds(headMismatch), [
    'verification-release:host-head-mismatch:claude-code'
  ]);
  assert.equal(headMismatch.comparison.ok, true);
  fixture.updateHostRef('claude-code');
  assertGreen(fixture.authority().resolve());

  fs.writeFileSync(path.join(fixture.roots['claude-code'], 'dirty.txt'), 'x\n');
  const dirty = fixture.authority().resolve();
  assert.equal(dirty.ok, false);
  assert.deepEqual(blockerIds(dirty), [
    'verification-release:host-worktree-dirty:claude-code'
  ]);
  assert.equal(dirty.comparison.ok, true);
  fs.rmSync(path.join(fixture.roots['claude-code'], 'dirty.txt'));
  assertGreen(fixture.authority().resolve());
});

test('host authority detects manifest, source, tree, skill, and wrapper drift', async (t) => {
  async function scenario(host, mutate, expected) {
    await t.test(expected, (subtest) => {
      const fixture = createHostAuthorityFixture(subtest);
      mutate(fixture, host);
      fixture.commitHost(host, `fixture: ${expected}`);
      const result = fixture.authority().resolve();
      assert.equal(result.ok, false);
      assert.equal(blockerIds(result).includes(expected), true, JSON.stringify(
        result.blockers,
        null,
        2
      ));
      assert.equal(
        blockerIds(result).some((id) => id.includes('host-head-mismatch')),
        false
      );
    });
  }

  await scenario('claude-code', (fixture, host) => {
    fixture.mutateManifest(host, (manifest) => {
      manifest.schema = 'specnav.verification.kernel-sync.invalid';
    });
  }, 'verification-drift:manifest-contract-mismatch:claude-code');

  await scenario('codefree-o', (fixture, host) => {
    fixture.mutateManifest(host, (manifest) => {
      manifest.source_commit = '0'.repeat(40);
    });
  }, 'verification-drift:manifest-source-commit-mismatch:codefree-o');

  await scenario('claude-code', (fixture, host) => {
    const pluginRoot = path.join(
      fixture.roots[host],
      fixture.descriptors[host].plugin
    );
    const target = 'assets/icon.svg';
    fs.appendFileSync(path.join(pluginRoot, target), '\n<!-- drift -->\n');
    fixture.mutateManifest(host, (manifest) => {
      const records = manifest.files
        .map((relative) => (
          `${relative}\0${sha256(fs.readFileSync(path.join(
            pluginRoot,
            relative
          )))}`
        ))
        .sort();
      manifest.source_tree_digest = sha256(records.join('\n'));
    });
  }, 'verification-drift:manifest-exact-file-provenance-mismatch:claude-code');

  await scenario('codefree-o', (fixture, host) => {
    const pluginRoot = path.join(
      fixture.roots[host],
      fixture.descriptors[host].plugin
    );
    const target = 'skills/specnav-verification/SKILL.md';
    fs.appendFileSync(path.join(pluginRoot, target), '\nDrifted skill.\n');
    fixture.mutateManifest(host, (manifest) => {
      manifest.transformed_files.find((entry) => (
        entry.target === target
      )).target_sha256 = sha256(fs.readFileSync(path.join(pluginRoot, target)));
    });
  }, 'verification-drift:manifest-transformed-file-provenance-mismatch:codefree-o');

  await scenario('claude-code', (fixture, host) => {
    const pluginRoot = path.join(
      fixture.roots[host],
      fixture.descriptors[host].plugin
    );
    const target = 'scripts/claude-verification-adapter.js';
    fs.appendFileSync(path.join(pluginRoot, target), '\n// drift\n');
    fixture.mutateManifest(host, (manifest) => {
      manifest.host_files.find((entry) => (
        entry.target === target
      )).target_sha256 = sha256(fs.readFileSync(path.join(pluginRoot, target)));
    });
  }, 'verification-drift:manifest-host-file-provenance-mismatch:claude-code');
});
