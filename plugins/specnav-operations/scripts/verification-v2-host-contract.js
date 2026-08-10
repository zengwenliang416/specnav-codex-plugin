'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_HOSTS = Object.freeze(['claude-code', 'codex', 'codefree-o']);
const OFFICIAL_HOST_REPOSITORIES = Object.freeze({
  'claude-code': Object.freeze({
    repository: 'https://github.com/zengwenliang416/specnav-claude-plugin.git',
    ref: 'refs/heads/main'
  }),
  codex: Object.freeze({
    repository: 'https://github.com/zengwenliang416/specnav-codex-plugin.git',
    ref: 'refs/heads/main'
  }),
  'codefree-o': Object.freeze({
    repository: 'https://github.com/zengwenliang416/specnav-codefree-o-plugin.git',
    ref: 'refs/heads/main'
  })
});
const HOST_DESCRIPTORS = Object.freeze({
  codex: Object.freeze({
    plugin: 'plugins/specnav-verification',
    manifest: null,
    hostFiles: Object.freeze(['scripts/codex-verification-adapter.js'])
  }),
  'claude-code': Object.freeze({
    plugin: 'plugins/specnav-verification',
    manifest: 'plugins/specnav-verification/specnav-kernel-source.json',
    hostFiles: Object.freeze([
      'commands/specnav-verification.md',
      'commands/specnav-verify.md',
      'scripts/claude-verification-adapter.js',
      'scripts/plugin-runtime.js',
      'specnav-stage.json',
      '.claude-plugin/plugin.json'
    ])
  }),
  'codefree-o': Object.freeze({
    plugin: 'modules/specnav-verification',
    manifest: 'modules/specnav-verification/specnav-kernel-source.json',
    hostFiles: Object.freeze([
      'scripts/codefree-o-verification-adapter.js',
      'scripts/plugin-runtime.js',
      'specnav-stage.json'
    ])
  })
});
const HOST_PROOF_RUNNER_MANIFEST = Object.freeze({
  javascriptEntries: Object.freeze([
    'plugins/specnav-operations/scripts/verification-v2-host-artifacts.js',
    'plugins/specnav-operations/scripts/verification-v2-proof.js',
    'plugins/specnav-verification/scripts/verification-runtime.js'
  ]),
  // These are loaded through path.join or requirePluginScript, not literal require.
  dynamicJavascriptEntries: Object.freeze([
    'plugins/specnav-core/scripts/specnav-lib.js',
    'plugins/specnav-verification/kernel/index.js',
    'plugins/specnav-verification/kernel/repair/index.js'
  ]),
  resourceFiles: Object.freeze([
    '.agents/plugins/marketplace.json',
    'plugins/specnav-core/.codex-plugin/plugin.json',
    'plugins/specnav-operations/.codex-plugin/plugin.json',
    'plugins/specnav-operations/scripts/safe-filesystem.py'
  ]),
  resourceDirectories: Object.freeze([
    'plugins/specnav-verification/assets',
    'plugins/specnav-verification/schemas'
  ])
});
const HOST_PROOF_RUNNER_FILES = Object.freeze([
  ...HOST_PROOF_RUNNER_MANIFEST.javascriptEntries,
  ...HOST_PROOF_RUNNER_MANIFEST.dynamicJavascriptEntries,
  ...HOST_PROOF_RUNNER_MANIFEST.resourceFiles
].sort());

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function confinedRegularFile(root, relative, blocker) {
  const base = fs.realpathSync(root);
  const segments = relative.split('/');
  if (
    segments.some((segment) => (
      !segment || segment === '.' || segment === '..'
    ))
  ) {
    throw new Error(blocker);
  }
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(blocker);
  }
  const real = fs.realpathSync(current);
  const fromRoot = path.relative(base, real);
  if (
    fromRoot.startsWith('..')
    || path.isAbsolute(fromRoot)
    || !fs.statSync(real).isFile()
  ) {
    throw new Error(blocker);
  }
  return real;
}

function confinedDirectory(root, relative, blocker) {
  const base = fs.realpathSync(root);
  const segments = relative.split('/');
  if (
    segments.some((segment) => (
      !segment || segment === '.' || segment === '..'
    ))
  ) {
    throw new Error(blocker);
  }
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(blocker);
  }
  const real = fs.realpathSync(current);
  const fromRoot = path.relative(base, real);
  if (
    fromRoot.startsWith('..')
    || path.isAbsolute(fromRoot)
    || !fs.statSync(real).isDirectory()
  ) {
    throw new Error(blocker);
  }
  return real;
}

function localRequireSpecifiers(source) {
  const specifiers = [];
  const pattern = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2].startsWith('.')) specifiers.push(match[2]);
  }
  return specifiers;
}

function resolveLocalDependency(repositoryRoot, importer, specifier) {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier)
  );
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) {
    throw new Error('verification-host-contract:runner-source-invalid');
  }
  const candidates = [
    base,
    `${base}.js`,
    `${base}.json`,
    path.posix.join(base, 'index.js'),
    path.posix.join(base, 'index.json')
  ];
  for (const candidate of candidates) {
    let stat;
    try {
      stat = fs.lstatSync(path.join(repositoryRoot, candidate));
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      throw error;
    }
    if (stat.isDirectory()) continue;
    return path.relative(
      fs.realpathSync(repositoryRoot),
      confinedRegularFile(
        repositoryRoot,
        candidate,
        'verification-host-contract:runner-source-invalid'
      )
    ).split(path.sep).join('/');
  }
  throw new Error('verification-host-contract:runner-source-invalid');
}

function javascriptDependencyClosure(repositoryRoot) {
  const pending = [
    ...HOST_PROOF_RUNNER_MANIFEST.javascriptEntries,
    ...HOST_PROOF_RUNNER_MANIFEST.dynamicJavascriptEntries
  ];
  const files = new Set();
  while (pending.length > 0) {
    const relative = pending.pop();
    if (files.has(relative)) continue;
    const file = confinedRegularFile(
      repositoryRoot,
      relative,
      'verification-host-contract:runner-source-invalid'
    );
    files.add(relative);
    if (path.extname(relative) !== '.js') continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of localRequireSpecifiers(source)) {
      const dependency = resolveLocalDependency(
        repositoryRoot,
        relative,
        specifier
      );
      if (!files.has(dependency)) pending.push(dependency);
    }
  }
  return files;
}

function resourceDirectoryFiles(repositoryRoot, relative) {
  const root = confinedDirectory(
    repositoryRoot,
    relative,
    'verification-host-contract:runner-source-invalid'
  );
  const files = [];
  const pending = [{ absolute: root, relative }];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current.absolute, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = path.posix.join(current.relative, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('verification-host-contract:runner-source-invalid');
      }
      if (entry.isDirectory()) {
        pending.push({
          absolute: path.join(current.absolute, entry.name),
          relative: childRelative
        });
      } else if (entry.isFile()) {
        confinedRegularFile(
          repositoryRoot,
          childRelative,
          'verification-host-contract:runner-source-invalid'
        );
        files.push(childRelative);
      } else {
        throw new Error('verification-host-contract:runner-source-invalid');
      }
    }
  }
  return files;
}

function hostProofRunnerSourceFiles(repositoryRoot) {
  const files = javascriptDependencyClosure(repositoryRoot);
  for (const relative of HOST_PROOF_RUNNER_MANIFEST.resourceFiles) {
    confinedRegularFile(
      repositoryRoot,
      relative,
      'verification-host-contract:runner-source-invalid'
    );
    files.add(relative);
  }
  for (const relative of HOST_PROOF_RUNNER_MANIFEST.resourceDirectories) {
    for (const resource of resourceDirectoryFiles(repositoryRoot, relative)) {
      files.add(resource);
    }
  }
  return [...files].sort();
}

function hostProofRunnerSourceDigest(repositoryRoot) {
  const records = hostProofRunnerSourceFiles(repositoryRoot).map((relative) => {
    const file = confinedRegularFile(
      repositoryRoot,
      relative,
      'verification-host-contract:runner-source-invalid'
    );
    return `${relative}\0${sha256(fs.readFileSync(file))}`;
  });
  return sha256(records.join('\n'));
}

function managedFixtureManifestDigest(fixtureRoot) {
  const file = confinedRegularFile(
    fixtureRoot,
    'manifest.json',
    'verification-host-contract:fixture-manifest-invalid'
  );
  return sha256(fs.readFileSync(file));
}

function hostProbeCommands(host, root, pluginPath, toolchain = {}, options = {}) {
  const node = toolchain.node?.path || process.execPath;
  const bash = toolchain.bash?.path || '/bin/bash';
  const npm = toolchain.npm?.path || path.resolve(
    path.dirname(process.execPath),
    '../lib/node_modules/npm/bin/npm-cli.js'
  );
  if (
    typeof options.managedRuntimeProbe !== 'string'
    || typeof options.runtimeBase !== 'string'
    || typeof options.runtimeVersion !== 'string'
  ) {
    throw new Error('verification-host-contract:managed-runtime-probe-required');
  }
  return [
    ...(host === 'codefree-o' ? [[
      npm,
      'ci',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund'
    ]] : []),
    [
      node,
      options.managedRuntimeProbe,
      'doctor',
      '--version',
      options.runtimeVersion,
      '--project',
      root,
      '--root',
      options.runtimeBase,
      '--json'
    ],
    [
      bash,
      path.join(root, 'tests', 'run-smoke.sh')
    ]
  ];
}

function expectedHostCommands(
  host,
  root,
  repositoryLock,
  toolchain = {},
  options = {}
) {
  return hostProbeCommands(
    host,
    root,
    path.join(root, repositoryLock.plugin_path),
    toolchain,
    options
  );
}

function officialHostLockValid(lock) {
  if (
    lock?.source_host !== 'codex'
    || !lock?.source
    || !lock?.hosts
  ) {
    return false;
  }
  return REQUIRED_HOSTS.every((host) => {
    const candidate = host === 'codex' ? lock.source : lock.hosts[host];
    const official = OFFICIAL_HOST_REPOSITORIES[host];
    const descriptor = HOST_DESCRIPTORS[host];
    return candidate?.repository === official.repository
      && candidate?.ref === official.ref
      && candidate?.plugin_path === descriptor.plugin
      && candidate?.manifest_path === descriptor.manifest;
  });
}

module.exports = {
  HOST_DESCRIPTORS,
  HOST_PROOF_RUNNER_FILES,
  HOST_PROOF_RUNNER_MANIFEST,
  OFFICIAL_HOST_REPOSITORIES,
  REQUIRED_HOSTS,
  expectedHostCommands,
  hostProofRunnerSourceDigest,
  hostProofRunnerSourceFiles,
  hostProbeCommands,
  managedFixtureManifestDigest,
  officialHostLockValid
};
