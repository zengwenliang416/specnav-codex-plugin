#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_PLUGIN = path.join(ROOT, 'plugins/specnav-verification');
const DEFAULT_TARGET = path.resolve(ROOT, '../specnav-claude-plugin');
const {
  SHARED_SCRIPTS,
  createHostSyncPlan,
  transformSkill: transformHostSkill
} = require(path.join(
  SOURCE_PLUGIN,
  'kernel/governance/host-provenance'
));

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function treeDigest(root, relativeFiles) {
  const records = relativeFiles
    .map((relative) => `${relative}\0${sha256(path.join(root, relative))}`)
    .sort();
  return crypto
    .createHash('sha256')
    .update(records.join('\n'))
    .digest('hex');
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, {
    recursive: true,
    withFileTypes: true
  })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function rejectSymlinks(root, label) {
  if (!fs.existsSync(root)) return;
  const candidates = [
    root,
    ...fs.readdirSync(root, {
      recursive: true,
      withFileTypes: true
    }).map((entry) => path.join(entry.parentPath, entry.name))
  ];
  for (const candidate of candidates) {
    if (fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(
        `claude-verification-sync:symlink-forbidden:${label}:`
        + path.relative(root, candidate)
      );
    }
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyTree(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function gitOutput(repositoryRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(
      `claude-verification-sync:git-failed:${args.join(':')}`
    );
  }
  return result.stdout.trim();
}

function readJson(file, blocker) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(blocker);
  }
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function rejectSymlinkComponents(repositoryRoot, candidate, label) {
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(candidate);
  if (!containedPath(root, target)) {
    throw new Error(
      `claude-verification-sync:path-outside-target:${label}`
    );
  }
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error(
      'claude-verification-sync:target-root-symlink-forbidden'
    );
  }
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (
      fs.existsSync(current)
      && fs.lstatSync(current).isSymbolicLink()
    ) {
      throw new Error(
        `claude-verification-sync:ancestor-symlink-forbidden:${label}:`
        + path.relative(root, current)
      );
    }
  }
  if (
    fs.existsSync(target)
    && !containedPath(fs.realpathSync(root), fs.realpathSync(target))
  ) {
    throw new Error(
      `claude-verification-sync:realpath-outside-target:${label}`
    );
  }
}

function validateTargetRepository(targetRepository) {
  const root = path.resolve(targetRepository);
  const gitMarker = path.join(root, '.git');
  if (!fs.existsSync(gitMarker)) {
    throw new Error('claude-verification-sync:target-not-git-repository');
  }
  rejectSymlinkComponents(root, gitMarker, 'git');

  const marketplaceFile = path.join(
    root,
    '.claude-plugin',
    'marketplace.json'
  );
  const targetPlugin = path.join(
    root,
    'plugins',
    'specnav-verification'
  );
  const pluginManifestFile = path.join(
    targetPlugin,
    '.claude-plugin',
    'plugin.json'
  );
  for (const [file, label] of [
    [marketplaceFile, 'marketplace'],
    [targetPlugin, 'plugin-root'],
    [pluginManifestFile, 'plugin-manifest']
  ]) {
    rejectSymlinkComponents(root, file, label);
    if (!fs.existsSync(file)) {
      throw new Error(
        `claude-verification-sync:target-identity-missing:${label}`
      );
    }
  }

  const marketplace = readJson(
    marketplaceFile,
    'claude-verification-sync:target-marketplace-invalid'
  );
  const plugin = readJson(
    pluginManifestFile,
    'claude-verification-sync:target-plugin-manifest-invalid'
  );
  if (
    marketplace.name !== 'specnav-marketplace'
    || !Array.isArray(marketplace.plugins)
    || !marketplace.plugins.some((entry) => (
      entry
      && entry.name === 'specnav-verification'
      && entry.source === './plugins/specnav-verification'
    ))
  ) {
    throw new Error(
      'claude-verification-sync:target-marketplace-identity-mismatch'
    );
  }
  if (plugin.name !== 'specnav-verification') {
    throw new Error(
      'claude-verification-sync:target-plugin-identity-mismatch'
    );
  }
  rejectSymlinks(targetPlugin, 'target');
  return {
    root,
    pluginsRoot: path.dirname(targetPlugin),
    targetPlugin
  };
}

function assertOwnedPathClean(targetRepository) {
  if (
    gitOutput(targetRepository, [
      'status',
      '--porcelain',
      '--',
      'plugins/specnav-verification'
    ]) !== ''
  ) {
    throw new Error('claude-verification-sync:owned-path-dirty');
  }
}

function transformSkill(source) {
  return transformHostSkill(source, 'claude-code');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function validateStagedPlugin(stagingPlugin, manifest) {
  const plan = createHostSyncPlan('claude-code');
  for (const relative of manifest.files) {
    if (
      sha256(path.join(SOURCE_PLUGIN, relative))
      !== sha256(path.join(stagingPlugin, relative))
    ) {
      throw new Error(
        `claude-verification-sync:staged-exact-file-mismatch:${relative}`
      );
    }
  }
  for (const entry of plan.transformedFiles) {
    if (
      !fs.readFileSync(path.join(stagingPlugin, entry.target))
        .equals(entry.content)
    ) {
      throw new Error(
        `claude-verification-sync:staged-transform-mismatch:${entry.target}`
      );
    }
  }
  for (const entry of plan.hostFiles) {
    if (
      !fs.readFileSync(path.join(stagingPlugin, entry.target))
        .equals(entry.content)
    ) {
      throw new Error(
        `claude-verification-sync:staged-host-file-mismatch:${entry.target}`
      );
    }
  }
  const expectedFiles = new Set([
    ...manifest.files,
    ...manifest.transformed_files.map((entry) => entry.target),
    ...manifest.host_files.map((entry) => entry.target),
    ...manifest.host_runtime_files.map((entry) => entry.target),
    'specnav-kernel-source.json'
  ]);
  const actualFiles = listFiles(stagingPlugin).map((file) => (
    path.relative(stagingPlugin, file).split(path.sep).join('/')
  ));
  const unexpected = actualFiles.filter((file) => !expectedFiles.has(file));
  const missing = [...expectedFiles].filter((file) => (
    !actualFiles.includes(file)
  ));
  if (unexpected.length || missing.length) {
    throw new Error(
      'claude-verification-sync:staged-tree-mismatch:'
      + JSON.stringify({ unexpected, missing })
    );
  }
}

function buildStagedPlugin(stagingPlugin) {
  const plan = createHostSyncPlan('claude-code');
  rejectSymlinks(SOURCE_PLUGIN, 'source');
  rejectSymlinks(stagingPlugin, 'staging');

  for (const relative of plan.exactFiles) {
    copyFile(
      path.join(SOURCE_PLUGIN, relative),
      path.join(stagingPlugin, relative)
    );
  }
  for (const entry of plan.transformedFiles) {
    fs.mkdirSync(
      path.dirname(path.join(stagingPlugin, entry.target)),
      { recursive: true }
    );
    fs.writeFileSync(path.join(stagingPlugin, entry.target), entry.content);
  }
  for (const entry of plan.hostFiles) {
    fs.mkdirSync(
      path.dirname(path.join(stagingPlugin, entry.target)),
      { recursive: true }
    );
    fs.writeFileSync(path.join(stagingPlugin, entry.target), entry.content);
  }

  const kernel = require(path.join(SOURCE_PLUGIN, 'kernel'));
  const sourceCommit = gitOutput(ROOT, ['rev-parse', 'HEAD']);
  const sourceDirty = gitOutput(ROOT, ['status', '--porcelain']) !== '';
  const manifest = {
    schema: 'specnav.verification.kernel-sync.v1',
    generated: true,
    generated_at: new Date().toISOString(),
    host: 'claude-code',
    source_repository: 'specnav-codex-plugin',
    source_commit: sourceCommit,
    source_dirty: sourceDirty,
    source_path: 'plugins/specnav-verification',
    source_tree_digest: plan.sourceTreeDigest,
    kernel: {
      name: kernel.metadata.name,
      version: kernel.metadata.version,
      api_version: kernel.metadata.apiVersion,
      contract_version: kernel.metadata.contractVersion,
      contract_digest: kernel.metadata.contractDigest
    },
    files: [...plan.exactFiles],
    transformed_files: plan.transformedFiles.map((entry) => ({
      source: entry.source,
      target: entry.target,
      transform: entry.transform,
      source_sha256: entry.source_sha256,
      target_sha256: entry.target_sha256
    })),
    host_files: plan.hostFiles.map((entry) => ({
      target: entry.target,
      target_sha256: entry.target_sha256
    })),
    host_runtime_files: plan.hostRuntimeFiles.map((target) => ({
      target,
      target_sha256: sha256(path.join(stagingPlugin, target))
    }))
  };
  writeJson(
    path.join(stagingPlugin, 'specnav-kernel-source.json'),
    manifest
  );
  validateStagedPlugin(stagingPlugin, manifest);
  return manifest;
}

function commitStagedPlugin(targetPlugin, stagingPlugin) {
  const backupPlugin = (
    `${targetPlugin}.specnav-backup-${process.pid}-${Date.now()}`
  );
  fs.renameSync(targetPlugin, backupPlugin);
  try {
    fs.renameSync(stagingPlugin, targetPlugin);
  } catch (error) {
    if (!fs.existsSync(targetPlugin) && fs.existsSync(backupPlugin)) {
      fs.renameSync(backupPlugin, targetPlugin);
    }
    throw error;
  }
  fs.rmSync(backupPlugin, { recursive: true, force: true });
}

function synchronize(targetRepository, options = {}) {
  const target = validateTargetRepository(targetRepository);
  assertOwnedPathClean(target.root);
  const stagingRoot = fs.mkdtempSync(
    path.join(target.pluginsRoot, '.specnav-verification-sync-')
  );
  const stagingPlugin = path.join(stagingRoot, 'specnav-verification');
  try {
    fs.mkdirSync(stagingPlugin, { recursive: true });
    copyFile(
      path.join(target.targetPlugin, 'scripts/plugin-runtime.js'),
      path.join(stagingPlugin, 'scripts/plugin-runtime.js')
    );
    const manifest = buildStagedPlugin(stagingPlugin);
    if (typeof options.beforeCommit === 'function') {
      options.beforeCommit({
        manifest,
        stagingPlugin,
        targetPlugin: target.targetPlugin,
        targetRepository: target.root
      });
    }
    commitStagedPlugin(target.targetPlugin, stagingPlugin);
    return manifest;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const targetRepository = path.resolve(
    argValue(args, '--target', DEFAULT_TARGET)
  );
  if (args.includes('--allow-dirty')) {
    throw new Error(
      'claude-verification-sync:dirty-override-forbidden'
    );
  }
  validateTargetRepository(targetRepository);
  assertOwnedPathClean(targetRepository);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'dry-run',
      target_repository: targetRepository,
      owned_path: 'plugins/specnav-verification',
      unrelated_dirty_paths_preserved: true,
      apply_command: (
        `node ${JSON.stringify(__filename)} --target `
        + `${JSON.stringify(targetRepository)} --apply`
      ),
      fallback_used: false
    }, null, 2)}\n`);
    return;
  }
  const manifest = synchronize(targetRepository);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'synchronized',
    target_repository: targetRepository,
    kernel: manifest.kernel,
    exact_file_count: manifest.files.length,
    transformed_file_count: manifest.transformed_files.length,
    unrelated_dirty_paths_preserved: true,
    fallback_used: false
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  SHARED_SCRIPTS,
  assertOwnedPathClean,
  buildStagedPlugin,
  commitStagedPlugin,
  rejectSymlinks,
  rejectSymlinkComponents,
  synchronize,
  treeDigest,
  transformSkill,
  validateStagedPlugin,
  validateTargetRepository
};
