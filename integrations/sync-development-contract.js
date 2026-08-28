#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  transformSkill
} = require(
  '../plugins/specnav-verification/kernel/governance/host-provenance'
);

const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(ROOT, 'plugins/specnav-development');
const MANIFEST = 'specnav-development-source.json';
const EXACT_FILES = Object.freeze([
  'scripts/development-contract.js',
  'scripts/development-receipt-authority.js',
  'scripts/evidence-runner.js',
  'scripts/task-acceptance-evidence.js'
]);
const TRANSFORMED_FILES = Object.freeze([
  'skills/specnav-break-loop/SKILL.md'
]);
const OWNED_FILES = Object.freeze([
  ...EXACT_FILES,
  ...TRANSFORMED_FILES,
  MANIFEST
]);
const HOSTS = Object.freeze({
  'claude-code': Object.freeze({
    targetPath: 'plugins/specnav-development',
    validate(root) {
      const plugin = readJson(
        path.join(
          root,
          'plugins/specnav-development/.claude-plugin/plugin.json'
        ),
        'development-sync:target-plugin-invalid'
      );
      return plugin.name === 'specnav-development';
    }
  }),
  'codefree-o': Object.freeze({
    targetPath: 'modules/specnav-development',
    validate(root) {
      const manifest = readJson(
        path.join(root, 'specnav.manifest.json'),
        'development-sync:target-manifest-invalid'
      );
      return manifest.schema === 'specnav.hostPackage.v1'
        && Array.isArray(manifest.modules)
        && manifest.modules.some((entry) => (
          entry
          && entry.name === 'specnav-development'
          && entry.path === 'modules/specnav-development'
        ));
    }
  }),
  dsh: Object.freeze({
    targetPath: 'presets/specnav/modules/specnav-development',
    validate(root) {
      const manifest = readJson(
        path.join(root, 'presets/specnav/specnav.suite.json'),
        'development-sync:target-manifest-invalid'
      );
      return manifest.schema === 'specnav.dshSuite.v1'
        && Array.isArray(manifest.modules)
        && manifest.modules.some((entry) => (
          entry
          && entry.name === 'specnav-development'
          && entry.path === 'modules/specnav-development'
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
    throw new Error(`development-sync:git-failed:${args.join(':')}`);
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
    throw new Error(`development-sync:path-outside-target:${label}`);
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
        `development-sync:symlink-forbidden:${label}:`
        + path.relative(repositoryRoot, current)
      );
    }
  }
}

function validateTarget(targetRepository, host) {
  const descriptor = HOSTS[host];
  if (!descriptor) throw new Error('development-sync:host-invalid');
  const root = path.resolve(targetRepository);
  if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error('development-sync:target-not-git-repository');
  }
  if (!descriptor.validate(root)) {
    throw new Error('development-sync:target-identity-mismatch');
  }
  const developmentRoot = path.join(root, descriptor.targetPath);
  for (const relative of OWNED_FILES) {
    rejectSymlinkComponents(root, path.join(developmentRoot, relative), relative);
  }
  return { descriptor, developmentRoot, root };
}

function assertSourceClean() {
  const sourcePaths = [...EXACT_FILES, ...TRANSFORMED_FILES].map((relative) => (
    path.posix.join('plugins/specnav-development', relative)
  ));
  if (git(ROOT, ['status', '--porcelain', '--', ...sourcePaths]) !== '') {
    throw new Error('development-sync:source-owned-path-dirty');
  }
}

function assertOwnedPathsClean(target) {
  const owned = OWNED_FILES.map((relative) => (
    path.posix.join(target.descriptor.targetPath, relative)
  ));
  if (git(target.root, ['status', '--porcelain', '--', ...owned]) !== '') {
    throw new Error('development-sync:owned-path-dirty');
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, fs.statSync(source).mode);
}

function buildStagedTree(stagingRoot, host) {
  for (const relative of EXACT_FILES) {
    copyFile(
      path.join(SOURCE_ROOT, relative),
      path.join(stagingRoot, relative)
    );
  }
  for (const relative of TRANSFORMED_FILES) {
    const source = fs.readFileSync(path.join(SOURCE_ROOT, relative), 'utf8');
    const target = path.join(stagingRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, transformSkill(source, host));
  }
  const manifest = {
    schema: 'specnav.development.contract-sync.v1',
    generated: true,
    generated_at: new Date().toISOString(),
    host,
    source_repository: 'specnav-codex-plugin',
    source_commit: git(ROOT, ['rev-parse', 'HEAD']),
    source_dirty: false,
    files: [
      ...EXACT_FILES.map((relative) => ({
        path: relative,
        transform: 'exact',
        source_sha256: sha256(path.join(SOURCE_ROOT, relative)),
        target_sha256: sha256(path.join(stagingRoot, relative))
      })),
      ...TRANSFORMED_FILES.map((relative) => ({
        path: relative,
        transform: `${host}-skill-v1`,
        source_sha256: sha256(path.join(SOURCE_ROOT, relative)),
        target_sha256: sha256(path.join(stagingRoot, relative))
      }))
    ]
  };
  writeJson(path.join(stagingRoot, MANIFEST), manifest);
  return manifest;
}

function commitStagedTree(developmentRoot, stagingRoot) {
  const backupRoot = fs.mkdtempSync(
    path.join(path.dirname(developmentRoot), '.specnav-development-backup-')
  );
  const installed = [];
  const backedUp = [];
  try {
    for (const relative of OWNED_FILES) {
      const target = path.join(developmentRoot, relative);
      const staged = path.join(stagingRoot, relative);
      const backup = path.join(backupRoot, relative);
      if (fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        backedUp.push(relative);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(staged, target);
      installed.push(relative);
    }
  } catch (error) {
    for (const relative of installed.reverse()) {
      fs.rmSync(path.join(developmentRoot, relative), { force: true });
    }
    for (const relative of backedUp.reverse()) {
      const backup = path.join(backupRoot, relative);
      const target = path.join(developmentRoot, relative);
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
    path.join(path.dirname(target.developmentRoot), '.specnav-development-stage-')
  );
  try {
    const manifest = buildStagedTree(stagingRoot, host);
    commitStagedTree(target.developmentRoot, stagingRoot);
    return manifest;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const targetRepository = path.resolve(argValue(args, '--target', ''));
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
      owned_files: OWNED_FILES,
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
  EXACT_FILES,
  HOSTS,
  MANIFEST,
  OWNED_FILES,
  TRANSFORMED_FILES,
  assertOwnedPathsClean,
  buildStagedTree,
  commitStagedTree,
  synchronize,
  validateTarget
};
