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
const CLAUDE_ROOT = path.resolve(
  process.env.SPECNAV_CLAUDE_ROOT
    || path.join(ROOT, '../specnav-claude-plugin')
);
const CODEFREE_ROOT = path.resolve(
  process.env.SPECNAV_CODEFREE_O_ROOT
    || path.join(ROOT, '../specnav-codefree-o-plugin')
);
const {
  MANIFEST,
  PROOF_FILES,
  assertOwnedPathsClean,
  buildStagedTree,
  commitStagedTree,
  validateTarget
} = require('../../../integrations/sync-operations-proof');

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

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitBytes(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024
  });
  assert.equal(
    result.status,
    0,
    String(result.stderr || '')
  );
  return result.stdout;
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

function synchronizeFixture(t, fixture, host) {
  const target = validateTarget(fixture.root, host);
  assertOwnedPathsClean(target);
  const stagingRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-ops-sync-stage-')
  );
  t.after(() => fs.rmSync(stagingRoot, { recursive: true, force: true }));
  const manifest = buildStagedTree(stagingRoot, host);
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
}

test('real downstream Operations proof bytes match one committed source', () => {
  const hosts = {
    'claude-code': {
      root: CLAUDE_ROOT,
      operationsRoot: path.join(
        CLAUDE_ROOT,
        'plugins/specnav-operations'
      )
    },
    'codefree-o': {
      root: CODEFREE_ROOT,
      operationsRoot: path.join(
        CODEFREE_ROOT,
        'modules/specnav-operations'
      )
    }
  };
  const manifests = Object.fromEntries(
    Object.entries(hosts).map(([host, descriptor]) => {
      const manifest = JSON.parse(fs.readFileSync(
        path.join(descriptor.operationsRoot, MANIFEST),
        'utf8'
      ));
      assert.equal(
        manifest.schema,
        'specnav.operations.verification-proof-sync.v1'
      );
      assert.equal(manifest.generated, true);
      assert.equal(manifest.host, host);
      assert.equal(manifest.source_repository, 'specnav-codex-plugin');
      assert.equal(manifest.source_dirty, false);
      assert.match(manifest.source_commit, /^[a-f0-9]{40}$/);
      assert.deepEqual(
        manifest.files.map((entry) => entry.path).sort(),
        [...PROOF_FILES].sort()
      );
      return [host, manifest];
    })
  );
  const sourceCommits = new Set(
    Object.values(manifests).map((manifest) => manifest.source_commit)
  );
  assert.equal(sourceCommits.size, 1);
  const [sourceCommit] = sourceCommits;
  gitBytes(ROOT, ['cat-file', '-e', `${sourceCommit}^{commit}`]);

  for (const relative of PROOF_FILES) {
    const committed = gitBytes(ROOT, [
      'show',
      `${sourceCommit}:plugins/specnav-operations/${relative}`
    ]);
    const expectedDigest = sha256Bytes(committed);
    assert.equal(
      sha256(path.join(SOURCE_ROOT, relative)),
      expectedDigest,
      `source worktree drift: ${relative}`
    );
    for (const [host, descriptor] of Object.entries(hosts)) {
      const entry = manifests[host].files.find((candidate) => (
        candidate.path === relative
      ));
      assert.equal(entry.sha256, expectedDigest, `${host}: ${relative}`);
      assert.equal(
        sha256(path.join(descriptor.operationsRoot, relative)),
        expectedDigest,
        `${host} worktree drift: ${relative}`
      );
    }
  }
});
