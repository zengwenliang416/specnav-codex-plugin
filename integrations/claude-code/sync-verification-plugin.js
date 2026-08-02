#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_PLUGIN = path.join(ROOT, 'plugins/specnav-verification');
const DEFAULT_TARGET = path.resolve(ROOT, '../specnav-claude-plugin');
const SHARED_SCRIPTS = Object.freeze([
  'anchor-scan.js',
  'evidence-runner.js',
  'host-verification-adapter.js',
  'rerun-scope.js',
  'verification-migrate.js',
  'verification-runtime.js',
  'verify-domains.js'
]);

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

function assertCleanTarget(targetRepository) {
  if (gitOutput(targetRepository, ['status', '--porcelain']) !== '') {
    throw new Error('claude-verification-sync:target-worktree-dirty');
  }
}

function transformSkill(source) {
  return source
    .replace(
      /as the Codex entrypoint/g,
      'as the Claude Code entrypoint'
    )
    .replace(
      /owning Codex plugin resolver/g,
      'owning Claude Code plugin resolver'
    )
    .replace(
      /owning SpecNav Codex plugin resolver/g,
      'owning SpecNav Claude Code plugin resolver'
    )
    .replace(
      /Codex plugin code must use `PLUGIN_ROOT` and explicit /g,
      'Claude Code skills must resolve installed plugin roots and explicit '
    )
    .replace(
      /scripts\/codex-verification-adapter\.js/g,
      'scripts/claude-verification-adapter.js'
    );
}

function commandTemplate(templateName) {
  return fs.readFileSync(
    path.join(__dirname, 'templates', templateName),
    'utf8'
  );
}

function pluginManifest(targetPlugin) {
  const file = path.join(targetPlugin, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.description = (
    'Full Verification 2.0 for Claude Code with approved cases, six-domain '
    + 'evidence, repair loops, gates, and review reports.'
  );
  manifest.keywords = [
    'claude-code',
    'openspec',
    'verification',
    'testing',
    'html-report'
  ];
  return manifest;
}

function stageManifest() {
  return {
    schema: 'specnav.stagePlugin.v1',
    plugin: 'specnav-verification',
    stage: 'verification',
    required: true,
    depends_on: [
      'specnav-core',
      'specnav-requirements',
      'specnav-prototype',
      'specnav-development'
    ],
    commands: [
      'specnav-verification',
      'specnav-verify'
    ],
    skills: [
      'specnav-verification',
      'specnav-verification-runtime-status',
      'specnav-verification-runtime-setup',
      'specnav-verify-plan',
      'specnav-verify-facticity',
      'specnav-verify-static',
      'specnav-verify-unit',
      'specnav-verify-redteam',
      'specnav-verify-e2e',
      'specnav-verify-sensory',
      'specnav-verify-rerun',
      'specnav-html-report'
    ],
    contracts: {
      verification: 'scripts/verify-domains.js',
      claude_adapter: 'scripts/claude-verification-adapter.js',
      kernel: 'kernel/index.js'
    },
    state_outputs: [
      'openspec/changes/<change>/verify/'
    ]
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function validateStagedPlugin(stagingPlugin, manifest) {
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
  for (const entry of manifest.transformed_files) {
    if (sha256(path.join(stagingPlugin, entry.target)) !== entry.target_sha256) {
      throw new Error(
        `claude-verification-sync:staged-transform-mismatch:${entry.target}`
      );
    }
  }
  for (const entry of manifest.host_files) {
    if (sha256(path.join(stagingPlugin, entry.target)) !== entry.target_sha256) {
      throw new Error(
        `claude-verification-sync:staged-host-file-mismatch:${entry.target}`
      );
    }
  }
  const expectedFiles = new Set([
    ...manifest.files,
    ...manifest.transformed_files.map((entry) => entry.target),
    ...manifest.host_files.map((entry) => entry.target),
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
  const exactFiles = new Set();
  const transformedFiles = [];
  rejectSymlinks(SOURCE_PLUGIN, 'source');
  rejectSymlinks(stagingPlugin, 'staging');

  copyFile(
    path.join(SOURCE_PLUGIN, 'package.json'),
    path.join(stagingPlugin, 'package.json')
  );
  exactFiles.add('package.json');

  for (const directory of ['kernel', 'schemas', 'assets']) {
    copyTree(
      path.join(SOURCE_PLUGIN, directory),
      path.join(stagingPlugin, directory)
    );
    for (const file of listFiles(path.join(SOURCE_PLUGIN, directory))) {
      exactFiles.add(path.relative(SOURCE_PLUGIN, file));
    }
  }

  for (const script of SHARED_SCRIPTS) {
    copyFile(
      path.join(SOURCE_PLUGIN, 'scripts', script),
      path.join(stagingPlugin, 'scripts', script)
    );
    exactFiles.add(path.posix.join('scripts', script));
  }

  copyFile(
    path.join(__dirname, 'claude-verification-adapter.js'),
    path.join(
      stagingPlugin,
      'scripts/claude-verification-adapter.js'
    )
  );

  for (const sourceSkill of fs.readdirSync(
    path.join(SOURCE_PLUGIN, 'skills'),
    { withFileTypes: true }
  ).filter((entry) => entry.isDirectory())) {
    const sourceRoot = path.join(
      SOURCE_PLUGIN,
      'skills',
      sourceSkill.name
    );
    const targetRoot = path.join(
      stagingPlugin,
      'skills',
      sourceSkill.name
    );
    copyTree(sourceRoot, targetRoot);
    for (const file of listFiles(sourceRoot)) {
      const relative = path.relative(SOURCE_PLUGIN, file);
      if (path.basename(file) === 'SKILL.md') {
        const targetFile = path.join(
          stagingPlugin,
          relative
        );
        const transformed = transformSkill(
          fs.readFileSync(file, 'utf8')
        );
        fs.writeFileSync(targetFile, transformed);
        transformedFiles.push({
          source: relative,
          target: relative,
          transform: 'claude-code-skill-v1',
          source_sha256: sha256(file),
          target_sha256: sha256(targetFile)
        });
      } else {
        exactFiles.add(relative);
      }
    }
  }

  const command = commandTemplate('specnav-verification.md');
  fs.mkdirSync(path.join(stagingPlugin, 'commands'), { recursive: true });
  fs.writeFileSync(
    path.join(stagingPlugin, 'commands/specnav-verification.md'),
    command
  );
  fs.writeFileSync(
    path.join(stagingPlugin, 'commands/specnav-verify.md'),
    command.replace(
      'description: Run the complete SpecNav Verification 2.0 lifecycle',
      'description: Alias for the complete SpecNav Verification 2.0 lifecycle'
    )
  );

  writeJson(
    path.join(stagingPlugin, '.claude-plugin/plugin.json'),
    pluginManifest(stagingPlugin)
  );
  writeJson(
    path.join(stagingPlugin, 'specnav-stage.json'),
    stageManifest()
  );

  const kernel = require(path.join(SOURCE_PLUGIN, 'kernel'));
  const sourceCommit = gitOutput(ROOT, ['rev-parse', 'HEAD']);
  const sourceDirty = gitOutput(ROOT, ['status', '--porcelain']) !== '';
  const synchronizedFiles = [...exactFiles].sort();
  const hostFilePaths = [
    'commands/specnav-verification.md',
    'commands/specnav-verify.md',
    'scripts/claude-verification-adapter.js',
    'scripts/plugin-runtime.js',
    'specnav-stage.json',
    '.claude-plugin/plugin.json'
  ];
  const manifest = {
    schema: 'specnav.verification.kernel-sync.v1',
    generated: true,
    generated_at: new Date().toISOString(),
    source_repository: 'specnav-codex-plugin',
    source_commit: sourceCommit,
    source_dirty: sourceDirty,
    source_path: 'plugins/specnav-verification',
    source_tree_digest: treeDigest(SOURCE_PLUGIN, synchronizedFiles),
    kernel: {
      name: kernel.metadata.name,
      version: kernel.metadata.version,
      api_version: kernel.metadata.apiVersion,
      contract_version: kernel.metadata.contractVersion,
      contract_digest: kernel.metadata.contractDigest
    },
    files: synchronizedFiles,
    transformed_files: transformedFiles.sort((left, right) => (
      left.target.localeCompare(right.target)
    )),
    host_files: hostFilePaths.map((target) => ({
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
  assertCleanTarget(target.root);
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
    copyFile(
      path.join(target.targetPlugin, '.claude-plugin/plugin.json'),
      path.join(stagingPlugin, '.claude-plugin/plugin.json')
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
  assertCleanTarget(targetRepository);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'dry-run',
      target_repository: targetRepository,
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
    fallback_used: false
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  SHARED_SCRIPTS,
  assertCleanTarget,
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
