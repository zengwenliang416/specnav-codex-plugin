'use strict';

const fs = require('node:fs');
const path = require('node:path');

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function rejectSymlinkComponents(root, candidate) {
  let current = root;
  for (const segment of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('verification-operations:trusted-core-symlink');
    }
  }
}

function trustedCoreScript(repositoryRoot) {
  const root = fs.realpathSync(path.resolve(repositoryRoot));
  const candidates = [
    path.join(root, 'plugins', 'specnav-core', 'scripts', 'specnav-lib.js'),
    path.join(root, 'modules', 'specnav-core', 'scripts', 'specnav-lib.js')
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    rejectSymlinkComponents(root, candidate);
    const real = fs.realpathSync(candidate);
    if (!containedPath(root, real) || !fs.statSync(real).isFile()) {
      throw new Error('verification-operations:trusted-core-invalid');
    }
    return real;
  }
  throw new Error('verification-operations:trusted-core-missing');
}

function requireTrustedCore(repositoryRoot) {
  return require(trustedCoreScript(repositoryRoot));
}

function trustedVerificationRoot(repositoryRoot) {
  const root = fs.realpathSync(path.resolve(repositoryRoot));
  const candidates = [
    path.join(root, 'plugins', 'specnav-verification'),
    path.join(root, 'modules', 'specnav-verification')
  ].filter((candidate) => fs.existsSync(candidate));
  if (candidates.length !== 1) {
    throw new Error('verification-operations:trusted-verification-root-invalid');
  }
  const candidate = candidates[0];
  rejectSymlinkComponents(root, candidate);
  const real = fs.realpathSync(candidate);
  if (!containedPath(root, real) || !fs.statSync(real).isDirectory()) {
    throw new Error('verification-operations:trusted-verification-root-invalid');
  }
  for (const relative of ['kernel/index.js', 'kernel/repair/index.js']) {
    const file = path.join(real, relative);
    rejectSymlinkComponents(root, file);
    if (!fs.statSync(file).isFile()) {
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
