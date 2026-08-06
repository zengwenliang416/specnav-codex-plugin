#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(ROOT, 'plugins/specnav-operations');
const MANIFEST = 'specnav-verification-proof-source.json';
const PROOF_FILES = Object.freeze([
  'scripts/operations-gate.js',
  'scripts/safe-filesystem.js',
  'scripts/safe-filesystem.py',
  'scripts/verification-v2-proof.js'
]);
const HOSTS = Object.freeze({
  'claude-code': Object.freeze({
    targetPath: 'plugins/specnav-operations',
    validate(root) {
      const plugin = readJson(
        path.join(
          root,
          'plugins/specnav-operations/.claude-plugin/plugin.json'
        ),
        'operations-proof-sync:target-plugin-invalid'
      );
      return plugin.name === 'specnav-operations';
    }
  }),
  'codefree-o': Object.freeze({
    targetPath: 'modules/specnav-operations',
    validate(root) {
      const manifest = readJson(
        path.join(root, 'specnav.manifest.json'),
        'operations-proof-sync:target-manifest-invalid'
      );
      return manifest.schema === 'specnav.hostPackage.v1'
        && Array.isArray(manifest.modules)
        && manifest.modules.some((entry) => (
          entry
          && entry.name === 'specnav-operations'
          && entry.path === 'modules/specnav-operations'
        ));
    }
  })
});

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function readJson(file, blocker) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(blocker);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`operations-proof-sync:git-failed:${args.join(':')}`);
  }
  return result.stdout.trim();
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function rejectSymlinkComponents(root, candidate, label) {
  const repositoryRoot = path.resolve(root);
  const target = path.resolve(candidate);
  if (!containedPath(repositoryRoot, target)) {
    throw new Error(`operations-proof-sync:path-outside-target:${label}`);
  }
  let current = repositoryRoot;
  for (
    const segment of path.relative(repositoryRoot, target)
      .split(path.sep)
      .filter(Boolean)
  ) {
    current = path.join(current, segment);
    if (
      fs.existsSync(current)
      && fs.lstatSync(current).isSymbolicLink()
    ) {
      throw new Error(
        `operations-proof-sync:symlink-forbidden:${label}:`
        + path.relative(repositoryRoot, current)
      );
    }
  }
}

function validateTarget(targetRepository, host) {
  const descriptor = HOSTS[host];
  if (!descriptor) throw new Error('operations-proof-sync:host-invalid');
  const root = path.resolve(targetRepository);
  if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error('operations-proof-sync:target-not-git-repository');
  }
  if (!descriptor.validate(root)) {
    throw new Error('operations-proof-sync:target-identity-mismatch');
  }
  const operationsRoot = path.join(root, descriptor.targetPath);
  for (const relative of PROOF_FILES) {
    const target = path.join(operationsRoot, relative);
    rejectSymlinkComponents(root, target, relative);
    if (!fs.existsSync(target)) {
      throw new Error(`operations-proof-sync:target-file-missing:${relative}`);
    }
  }
  return { descriptor, operationsRoot, root };
}

function assertOwnedPathsClean(target) {
  const owned = [
    ...PROOF_FILES.map((relative) => (
      path.posix.join(target.descriptor.targetPath, relative)
    )),
    path.posix.join(target.descriptor.targetPath, MANIFEST)
  ];
  if (git(target.root, ['status', '--porcelain', '--', ...owned]) !== '') {
    throw new Error('operations-proof-sync:owned-path-dirty');
  }
}

function assertSourceClean() {
  const sourcePaths = PROOF_FILES.map((relative) => (
    path.posix.join('plugins/specnav-operations', relative)
  ));
  if (git(ROOT, ['status', '--porcelain', '--', ...sourcePaths]) !== '') {
    throw new Error('operations-proof-sync:source-owned-path-dirty');
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, fs.statSync(source).mode);
}

function buildStagedTree(stagingRoot, host) {
  for (const relative of PROOF_FILES) {
    copyFile(
      path.join(SOURCE_ROOT, relative),
      path.join(stagingRoot, relative)
    );
  }
  const manifest = {
    schema: 'specnav.operations.verification-proof-sync.v1',
    generated: true,
    generated_at: new Date().toISOString(),
    host,
    source_repository: 'specnav-codex-plugin',
    source_commit: git(ROOT, ['rev-parse', 'HEAD']),
    source_dirty: false,
    files: PROOF_FILES.map((relative) => ({
      path: relative,
      sha256: sha256(path.join(SOURCE_ROOT, relative))
    }))
  };
  writeJson(path.join(stagingRoot, MANIFEST), manifest);
  for (const entry of manifest.files) {
    if (
      entry.sha256 !== sha256(path.join(stagingRoot, entry.path))
    ) {
      throw new Error(
        `operations-proof-sync:staged-file-mismatch:${entry.path}`
      );
    }
  }
  return manifest;
}

function commitStagedTree(operationsRoot, stagingRoot) {
  const backupRoot = fs.mkdtempSync(
    path.join(path.dirname(operationsRoot), '.specnav-ops-proof-backup-')
  );
  const installed = [];
  const backedUp = [];
  const relatives = [...PROOF_FILES, MANIFEST];
  try {
    for (const relative of relatives) {
      const target = path.join(operationsRoot, relative);
      const backup = path.join(backupRoot, relative);
      if (fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        backedUp.push(relative);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(stagingRoot, relative), target);
      installed.push(relative);
    }
  } catch (error) {
    for (const relative of installed.reverse()) {
      fs.rmSync(path.join(operationsRoot, relative), { force: true });
    }
    for (const relative of backedUp.reverse()) {
      const backup = path.join(backupRoot, relative);
      const target = path.join(operationsRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(backup, target);
    }
    throw error;
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

function synchronize(targetRepository, host) {
  const target = validateTarget(targetRepository, host);
  assertSourceClean();
  assertOwnedPathsClean(target);
  const stagingRoot = fs.mkdtempSync(
    path.join(path.dirname(target.operationsRoot), '.specnav-ops-proof-stage-')
  );
  try {
    const manifest = buildStagedTree(stagingRoot, host);
    commitStagedTree(target.operationsRoot, stagingRoot);
    return manifest;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const targetRepository = path.resolve(
    argValue(args, '--target', '')
  );
  const host = argValue(args, '--host');
  const target = validateTarget(targetRepository, host);
  assertSourceClean();
  assertOwnedPathsClean(target);
  if (!args.includes('--apply')) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'dry-run',
      host,
      target_repository: target.root,
      owned_files: [...PROOF_FILES, MANIFEST],
      unrelated_dirty_paths_preserved: true,
      fallback_used: false
    }, null, 2)}\n`);
    return;
  }
  const manifest = synchronize(target.root, host);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'synchronized',
    host,
    target_repository: target.root,
    source_commit: manifest.source_commit,
    file_count: manifest.files.length,
    unrelated_dirty_paths_preserved: true,
    fallback_used: false
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  HOSTS,
  MANIFEST,
  PROOF_FILES,
  assertOwnedPathsClean,
  buildStagedTree,
  commitStagedTree,
  synchronize,
  validateTarget
};
