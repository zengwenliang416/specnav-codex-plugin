'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function rejectSymlinkComponents(root, candidate) {
  if (!containedPath(root, candidate)) {
    throw new Error('verification-operations:trusted-path-escape');
  }
  let current = root;
  for (const segment of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('verification-operations:trusted-core-symlink');
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pluginIdentity(root) {
  for (const relative of [
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    'specnav-stage.json'
  ]) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const value = readJson(file);
    if (typeof value?.name === 'string') return value.name;
    if (typeof value?.plugin === 'string') return value.plugin;
  }
  return null;
}

function validatePluginRoot(root, candidate, pluginName) {
  if (!fs.existsSync(candidate)) return null;
  rejectSymlinkComponents(root, candidate);
  const real = fs.realpathSync(candidate);
  if (
    !containedPath(root, real)
    || !fs.statSync(real).isDirectory()
    || fs.existsSync(path.join(real, '.orphaned_at'))
    || pluginIdentity(real) !== pluginName
  ) {
    return null;
  }
  return real;
}

function localPluginRoot(root, pluginName) {
  const candidates = [
    path.join(root, 'plugins', pluginName),
    path.join(root, 'modules', pluginName)
  ]
    .map((candidate) => validatePluginRoot(root, candidate, pluginName))
    .filter(Boolean);
  if (candidates.length > 1) {
    throw new Error(`verification-operations:trusted-${pluginName}-ambiguous`);
  }
  return candidates[0] || null;
}

function activeInstalledRoots(root, pluginName) {
  const base = path.join(root, pluginName);
  if (!fs.existsSync(base)) return [];
  rejectSymlinkComponents(root, base);
  if (!fs.statSync(base).isDirectory()) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      version: entry.name,
      root: validatePluginRoot(
        root,
        path.join(base, entry.name),
        pluginName
      )
    }))
    .filter((entry) => entry.root)
    .sort((left, right) => VERSION_COLLATOR.compare(
      right.version,
      left.version
    ));
}

function installedPluginRoot(root, pluginName, options, errorId) {
  const candidates = activeInstalledRoots(root, pluginName);
  if (candidates.length === 0) throw new Error(errorId);

  const operationsRoot = options.operationsRoot
    ? path.resolve(options.operationsRoot)
    : path.resolve(__dirname, '..');
  let operationsVersion = null;
  if (containedPath(root, operationsRoot)) {
    const relative = path.relative(root, operationsRoot).split(path.sep);
    if (
      relative.length === 2
      && relative[0] === 'specnav-operations'
    ) {
      operationsVersion = relative[1];
    }
  }
  const selected = candidates.find(
    (candidate) => candidate.version === operationsVersion
  ) || candidates[0];

  const env = options.env || process.env;
  const envName = pluginName === 'specnav-core'
    ? 'SPECNAV_CORE_ROOT'
    : 'SPECNAV_VERIFICATION_ROOT';
  if (env[envName]) {
    let explicit;
    try {
      explicit = fs.realpathSync(path.resolve(env[envName]));
    } catch {
      throw new Error(errorId);
    }
    if (explicit !== selected.root) throw new Error(errorId);
  }
  return selected.root;
}

function trustedPluginRoot(repositoryRoot, pluginName, options, errorId) {
  const root = fs.realpathSync(path.resolve(repositoryRoot));
  const local = localPluginRoot(root, pluginName);
  if (local) return { repositoryRoot: root, pluginRoot: local };
  return {
    repositoryRoot: root,
    pluginRoot: installedPluginRoot(root, pluginName, options, errorId)
  };
}

function trustedCoreScript(repositoryRoot, options = {}) {
  const trusted = trustedPluginRoot(
    repositoryRoot,
    'specnav-core',
    options,
    'verification-operations:trusted-core-missing'
  );
  const candidate = path.join(
    trusted.pluginRoot,
    'scripts',
    'specnav-lib.js'
  );
  rejectSymlinkComponents(trusted.repositoryRoot, candidate);
  if (!fs.existsSync(candidate)) {
    throw new Error('verification-operations:trusted-core-missing');
  }
  const real = fs.realpathSync(candidate);
  if (
    !containedPath(trusted.pluginRoot, real)
    || !fs.statSync(real).isFile()
  ) {
    throw new Error('verification-operations:trusted-core-invalid');
  }
  return real;
}

function requireTrustedCore(repositoryRoot, options = {}) {
  return require(trustedCoreScript(repositoryRoot, options));
}

function trustedVerificationRoot(repositoryRoot, options = {}) {
  const trusted = trustedPluginRoot(
    repositoryRoot,
    'specnav-verification',
    options,
    'verification-operations:trusted-verification-root-invalid'
  );
  const real = trusted.pluginRoot;
  for (const relative of ['kernel/index.js', 'kernel/repair/index.js']) {
    const file = path.join(real, relative);
    rejectSymlinkComponents(trusted.repositoryRoot, file);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(
        'verification-operations:trusted-verification-root-invalid'
      );
    }
  }
  return real;
}

module.exports = {
  requireTrustedCore,
  trustedVerificationRoot,
  trustedCoreScript
};
