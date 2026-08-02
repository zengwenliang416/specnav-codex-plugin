#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_PLUGIN = path.join(ROOT, 'plugins/specnav-verification');
const DEFAULT_TARGET = path.resolve(ROOT, '../specnav-codefree-o-plugin');
const OWNED_PATH = 'modules/specnav-verification';
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
        `codefree-o-verification-sync:symlink-forbidden:${label}:`
        + path.relative(root, candidate)
      );
    }
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
      `codefree-o-verification-sync:path-outside-target:${label}`
    );
  }
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error(
      'codefree-o-verification-sync:target-root-symlink-forbidden'
    );
  }
  let current = root;
  for (
    const segment of path.relative(root, target).split(path.sep).filter(Boolean)
  ) {
    current = path.join(current, segment);
    if (
      fs.existsSync(current)
      && fs.lstatSync(current).isSymbolicLink()
    ) {
      throw new Error(
        `codefree-o-verification-sync:ancestor-symlink-forbidden:${label}:`
        + path.relative(root, current)
      );
    }
  }
  if (
    fs.existsSync(target)
    && !containedPath(fs.realpathSync(root), fs.realpathSync(target))
  ) {
    throw new Error(
      `codefree-o-verification-sync:realpath-outside-target:${label}`
    );
  }
}

function readJson(file, blocker) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(blocker);
  }
}

function gitOutput(repositoryRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(
      `codefree-o-verification-sync:git-failed:${args.join(':')}`
    );
  }
  return result.stdout.trim();
}

function validateTargetRepository(targetRepository) {
  const root = path.resolve(targetRepository);
  if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error(
      'codefree-o-verification-sync:target-not-git-repository'
    );
  }
  const packageFile = path.join(root, 'package.json');
  const manifestFile = path.join(root, 'specnav.manifest.json');
  const targetModule = path.join(root, OWNED_PATH);
  const pluginRuntime = path.join(
    targetModule,
    'scripts/plugin-runtime.js'
  );
  for (const [candidate, label] of [
    [packageFile, 'package'],
    [manifestFile, 'manifest'],
    [targetModule, 'verification-module'],
    [pluginRuntime, 'plugin-runtime']
  ]) {
    rejectSymlinkComponents(root, candidate, label);
    if (!fs.existsSync(candidate)) {
      throw new Error(
        `codefree-o-verification-sync:target-identity-missing:${label}`
      );
    }
  }
  const packageJson = readJson(
    packageFile,
    'codefree-o-verification-sync:target-package-invalid'
  );
  const manifest = readJson(
    manifestFile,
    'codefree-o-verification-sync:target-manifest-invalid'
  );
  if (packageJson.name !== 'specnav-codefree-o-plugin') {
    throw new Error(
      'codefree-o-verification-sync:target-package-identity-mismatch'
    );
  }
  if (
    manifest.schema !== 'specnav.hostPackage.v1'
    || !Array.isArray(manifest.modules)
    || !manifest.modules.some((entry) => (
      entry
      && entry.name === 'specnav-verification'
      && entry.path === OWNED_PATH
    ))
  ) {
    throw new Error(
      'codefree-o-verification-sync:target-manifest-identity-mismatch'
    );
  }
  rejectSymlinks(targetModule, 'target');
  return {
    root,
    modulesRoot: path.dirname(targetModule),
    targetModule,
    pluginRuntime
  };
}

function assertOwnedPathsClean(targetRepository) {
  const status = gitOutput(targetRepository, [
    'status',
    '--porcelain',
    '--',
    OWNED_PATH
  ]);
  if (status !== '') {
    throw new Error(
      'codefree-o-verification-sync:owned-path-dirty'
    );
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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function transformSkill(source) {
  return source
    .replace(/when a Codex user/g, 'when a CodeFree-O user')
    .replace(/as the Codex entrypoint/g, 'as the CodeFree-O entrypoint')
    .replace(
      /owning Codex plugin resolver/g,
      'owning CodeFree-O module resolver'
    )
    .replace(
      /owning SpecNav Codex plugin resolver/g,
      'owning SpecNav CodeFree-O module resolver'
    )
    .replace(
      /Codex plugin code must use `PLUGIN_ROOT` and explicit /g,
      'CodeFree-O skills must resolve module roots from `shell.env` and explicit '
    )
    .replace(
      /scripts\/codex-verification-adapter\.js/g,
      'scripts/codefree-o-verification-adapter.js'
    );
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
      codefree_o_adapter: 'scripts/codefree-o-verification-adapter.js',
      kernel: 'kernel/index.js'
    },
    state_outputs: [
      'openspec/changes/<change>/verify/'
    ]
  };
}

function validateStagedModule(stagingModule, manifest) {
  for (const relative of manifest.files) {
    if (
      sha256(path.join(SOURCE_PLUGIN, relative))
      !== sha256(path.join(stagingModule, relative))
    ) {
      throw new Error(
        `codefree-o-verification-sync:staged-exact-file-mismatch:${relative}`
      );
    }
  }
  for (const entry of [
    ...manifest.transformed_files,
    ...manifest.host_files
  ]) {
    if (
      sha256(path.join(stagingModule, entry.target))
      !== entry.target_sha256
    ) {
      throw new Error(
        `codefree-o-verification-sync:staged-file-mismatch:${entry.target}`
      );
    }
  }
  const expectedFiles = new Set([
    ...manifest.files,
    ...manifest.transformed_files.map((entry) => entry.target),
    ...manifest.host_files.map((entry) => entry.target),
    'specnav-kernel-source.json'
  ]);
  const actualFiles = listFiles(stagingModule).map((file) => (
    path.relative(stagingModule, file).split(path.sep).join('/')
  ));
  const unexpected = actualFiles.filter((file) => !expectedFiles.has(file));
  const missing = [...expectedFiles].filter((file) => (
    !actualFiles.includes(file)
  ));
  if (unexpected.length || missing.length) {
    throw new Error(
      'codefree-o-verification-sync:staged-tree-mismatch:'
      + JSON.stringify({ unexpected, missing })
    );
  }
}

function buildStagedModule(stagingModule) {
  const exactFiles = new Set();
  const transformedFiles = [];
  rejectSymlinks(SOURCE_PLUGIN, 'source');
  rejectSymlinks(stagingModule, 'staging');

  copyFile(
    path.join(SOURCE_PLUGIN, 'package.json'),
    path.join(stagingModule, 'package.json')
  );
  exactFiles.add('package.json');

  for (const directory of ['kernel', 'schemas', 'assets']) {
    copyTree(
      path.join(SOURCE_PLUGIN, directory),
      path.join(stagingModule, directory)
    );
    for (const file of listFiles(path.join(SOURCE_PLUGIN, directory))) {
      exactFiles.add(path.relative(SOURCE_PLUGIN, file));
    }
  }

  for (const script of SHARED_SCRIPTS) {
    copyFile(
      path.join(SOURCE_PLUGIN, 'scripts', script),
      path.join(stagingModule, 'scripts', script)
    );
    exactFiles.add(path.posix.join('scripts', script));
  }
  copyFile(
    path.join(__dirname, 'codefree-o-verification-adapter.js'),
    path.join(
      stagingModule,
      'scripts/codefree-o-verification-adapter.js'
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
      stagingModule,
      'skills',
      sourceSkill.name
    );
    copyTree(sourceRoot, targetRoot);
    for (const file of listFiles(sourceRoot)) {
      const relative = path.relative(SOURCE_PLUGIN, file);
      if (path.basename(file) === 'SKILL.md') {
        const targetFile = path.join(stagingModule, relative);
        fs.writeFileSync(
          targetFile,
          transformSkill(fs.readFileSync(file, 'utf8'))
        );
        transformedFiles.push({
          source: relative,
          target: relative,
          transform: 'codefree-o-skill-v1',
          source_sha256: sha256(file),
          target_sha256: sha256(targetFile)
        });
      } else {
        exactFiles.add(relative);
      }
    }
  }

  writeJson(
    path.join(stagingModule, 'specnav-stage.json'),
    stageManifest()
  );

  const kernel = require(path.join(SOURCE_PLUGIN, 'kernel'));
  const synchronizedFiles = [...exactFiles].sort();
  const hostFiles = [
    'scripts/codefree-o-verification-adapter.js',
    'scripts/plugin-runtime.js',
    'specnav-stage.json'
  ].map((target) => ({
    target,
    target_sha256: sha256(path.join(stagingModule, target))
  }));
  const manifest = {
    schema: 'specnav.verification.kernel-sync.v1',
    generated: true,
    generated_at: new Date().toISOString(),
    host: 'codefree-o',
    source_repository: 'specnav-codex-plugin',
    source_commit: gitOutput(ROOT, ['rev-parse', 'HEAD']),
    source_dirty: gitOutput(ROOT, ['status', '--porcelain']) !== '',
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
    host_files: hostFiles
  };
  writeJson(
    path.join(stagingModule, 'specnav-kernel-source.json'),
    manifest
  );
  validateStagedModule(stagingModule, manifest);
  return manifest;
}

function commitStagedModule(targetModule, stagingModule) {
  const backupModule = (
    `${targetModule}.specnav-backup-${process.pid}-${Date.now()}`
  );
  fs.renameSync(targetModule, backupModule);
  try {
    fs.renameSync(stagingModule, targetModule);
  } catch (error) {
    if (!fs.existsSync(targetModule) && fs.existsSync(backupModule)) {
      fs.renameSync(backupModule, targetModule);
    }
    throw error;
  }
  fs.rmSync(backupModule, { recursive: true, force: true });
}

function synchronize(targetRepository, options = {}) {
  const target = validateTargetRepository(targetRepository);
  assertOwnedPathsClean(target.root);
  const stagingRoot = fs.mkdtempSync(
    path.join(target.modulesRoot, '.specnav-verification-sync-')
  );
  const stagingModule = path.join(stagingRoot, 'specnav-verification');
  try {
    fs.mkdirSync(stagingModule, { recursive: true });
    copyFile(
      target.pluginRuntime,
      path.join(stagingModule, 'scripts/plugin-runtime.js')
    );
    const manifest = buildStagedModule(stagingModule);
    if (typeof options.beforeCommit === 'function') {
      options.beforeCommit({
        manifest,
        stagingModule,
        targetModule: target.targetModule,
        targetRepository: target.root
      });
    }
    commitStagedModule(target.targetModule, stagingModule);
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
  validateTargetRepository(targetRepository);
  assertOwnedPathsClean(targetRepository);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'dry-run',
      target_repository: targetRepository,
      owned_path: OWNED_PATH,
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
  OWNED_PATH,
  SHARED_SCRIPTS,
  assertOwnedPathsClean,
  buildStagedModule,
  rejectSymlinkComponents,
  rejectSymlinks,
  synchronize,
  transformSkill,
  treeDigest,
  validateStagedModule,
  validateTargetRepository
};
