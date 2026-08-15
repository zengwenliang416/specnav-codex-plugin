'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_ROOT = path.join(ROOT, 'plugins/specnav-operations');
const {
  MANIFEST,
  PROOF_FILES,
  assertOwnedPathsClean,
  buildStagedTree,
  commitStagedTree,
  validateTarget
} = require('../../../integrations/sync-operations-proof');
const {
  hostProofRunnerSourceFiles
} = require(
  '../../../plugins/specnav-operations/scripts/verification-v2-host-contract'
);

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function targetFixture(t, host) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-ops-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const targetPath = host === 'claude-code'
    ? 'plugins/specnav-operations'
    : 'modules/specnav-operations';
  if (host === 'claude-code') {
    writeJson(
      path.join(root, `${targetPath}/.claude-plugin/plugin.json`),
      { name: 'specnav-operations' }
    );
  } else {
    writeJson(path.join(root, 'specnav.manifest.json'), {
      schema: 'specnav.hostPackage.v1',
      modules: [{
        name: 'specnav-operations',
        path: targetPath
      }]
    });
  }
  for (const relative of PROOF_FILES) {
    const target = path.join(root, targetPath, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `baseline:${relative}\n`);
  }
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\n');
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=SpecNav Tests',
    '-c',
    'user.email=specnav@example.invalid',
    'commit',
    '-qm',
    'fixture'
  ]);
  return { root, targetPath };
}

function sourceFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-ops-source-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = new Set([
    ...hostProofRunnerSourceFiles(ROOT),
    ...PROOF_FILES.map((relative) => (
      path.posix.join('plugins/specnav-operations', relative)
    ))
  ]);
  for (const relative of files) {
    const source = path.join(ROOT, relative);
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, fs.statSync(source).mode);
  }
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=SpecNav Tests',
    '-c',
    'user.email=specnav@example.invalid',
    'commit',
    '-qm',
    'canonical source fixture'
  ]);
  return {
    root,
    commit: git(root, ['rev-parse', 'HEAD']),
    operationsRoot: path.join(root, 'plugins/specnav-operations')
  };
}

function synchronizeFixture(t, fixture, host, options = {}) {
  const target = validateTarget(fixture.root, host);
  assertOwnedPathsClean(target);
  const stagingRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-ops-sync-stage-')
  );
  t.after(() => fs.rmSync(stagingRoot, { recursive: true, force: true }));
  const manifest = buildStagedTree(stagingRoot, host, options);
  commitStagedTree(target.operationsRoot, stagingRoot);
  return manifest;
}

for (const host of ['claude-code', 'codefree-o']) {
  test(`${host} Operations proof sync preserves unrelated dirty files`, (t) => {
    const fixture = targetFixture(t, host);
    fs.writeFileSync(path.join(fixture.root, 'README.md'), 'local edit\n');

    const manifest = synchronizeFixture(t, fixture, host);

    assert.equal(fs.readFileSync(
      path.join(fixture.root, 'README.md'),
      'utf8'
    ), 'local edit\n');
    assert.equal(manifest.host, host);
    assert.equal(manifest.source_dirty, false);
    for (const relative of PROOF_FILES) {
      assert.equal(
        sha256(path.join(SOURCE_ROOT, relative)),
        sha256(path.join(fixture.root, fixture.targetPath, relative)),
        relative
      );
    }
    assert.equal(
      fs.existsSync(path.join(
        fixture.root,
        fixture.targetPath,
        MANIFEST
      )),
      true
    );
  });

  test(`${host} Operations proof sync blocks owned conflicts`, (t) => {
    const fixture = targetFixture(t, host);
    const target = path.join(
      fixture.root,
      fixture.targetPath,
      PROOF_FILES[0]
    );
    fs.writeFileSync(target, 'local owned edit\n');

    assert.throws(
      () => assertOwnedPathsClean(validateTarget(fixture.root, host)),
      /operations-proof-sync:owned-path-dirty/
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'local owned edit\n');
  });

  test(`${host} Operations proof sync installs newly owned files`, (t) => {
    const fixture = targetFixture(t, host);
    const relative = 'scripts/verification-v2-host-artifacts.js';
    const target = path.join(fixture.root, fixture.targetPath, relative);
    fs.rmSync(target);
    git(fixture.root, [
      'add',
      '-u',
      '--',
      path.join(fixture.targetPath, relative)
    ]);
    git(fixture.root, [
      '-c',
      'user.name=SpecNav Tests',
      '-c',
      'user.email=specnav@example.invalid',
      'commit',
      '-qm',
      'remove future owned file'
    ]);

    synchronizeFixture(t, fixture, host);

    assert.equal(
      sha256(target),
      sha256(path.join(SOURCE_ROOT, relative))
    );
  });
}

test('temporary downstream Operations proof bytes match one committed source', (t) => {
  const source = sourceFixture(t);
  const hosts = Object.fromEntries(
    ['claude-code', 'codefree-o'].map((host) => {
      const fixture = targetFixture(t, host);
      const manifest = synchronizeFixture(t, fixture, host, {
        sourceRepositoryRoot: source.root
      });
      return [host, {
        ...fixture,
        manifest
      }];
    })
  );
  const manifests = Object.fromEntries(Object.entries(hosts).map(
    ([host, descriptor]) => {
      const manifest = descriptor.manifest;
      assert.equal(
        manifest.schema,
        'specnav.operations.verification-proof-sync.v1'
      );
      assert.equal(manifest.generated, true);
      assert.equal(manifest.host, host);
      assert.equal(manifest.source_repository, 'specnav-codex-plugin');
      assert.equal(manifest.source_dirty, false);
      assert.equal(manifest.source_commit, source.commit);
      assert.deepEqual(
        manifest.files.map((entry) => entry.path).sort(),
        [...PROOF_FILES].sort()
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(
          path.join(descriptor.root, descriptor.targetPath, MANIFEST),
          'utf8'
        )),
        manifest
      );
      return [host, manifest];
    }
  ));
  const sourceCommits = new Set(
    Object.values(manifests).map((manifest) => manifest.source_commit)
  );
  assert.equal(sourceCommits.size, 1);
  const [sourceCommit] = sourceCommits;
  assert.equal(sourceCommit, source.commit);
  git(source.root, ['cat-file', '-e', `${sourceCommit}^{commit}`]);

  for (const relative of PROOF_FILES) {
    const expectedDigest = sha256(path.join(
      source.operationsRoot,
      relative
    ));
    assert.equal(
      sha256(path.join(SOURCE_ROOT, relative)),
      expectedDigest,
      `source fixture drift: ${relative}`
    );
    for (const [host, descriptor] of Object.entries(hosts)) {
      const entry = manifests[host].files.find((candidate) => (
        candidate.path === relative
      ));
      assert.equal(entry.sha256, expectedDigest, `${host}: ${relative}`);
      assert.equal(
        sha256(path.join(
          descriptor.root,
          descriptor.targetPath,
          relative
        )),
        expectedDigest,
        `${host} synchronized fixture drift: ${relative}`
      );
    }
  }
});
