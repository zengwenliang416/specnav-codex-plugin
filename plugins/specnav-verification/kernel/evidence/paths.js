'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function existingRealpath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function validateStoreRoot(changeRoot, root) {
  if (typeof changeRoot !== 'string' || typeof root !== 'string') {
    return {
      ok: false,
      id: 'verification-evidence:store-root-invalid'
    };
  }
  const changeLexical = path.resolve(changeRoot);
  const rootLexical = path.resolve(root);
  if (!isContained(changeLexical, rootLexical)) {
    return {
      ok: false,
      id: 'verification-evidence:store-root-outside-change'
    };
  }
  let changeStat;
  try {
    changeStat = fs.lstatSync(changeLexical);
  } catch {
    return {
      ok: false,
      id: 'verification-evidence:change-root-missing'
    };
  }
  if (changeStat.isSymbolicLink()) {
    return {
      ok: false,
      id: 'verification-evidence:store-root-symlink'
    };
  }
  if (!changeStat.isDirectory()) {
    return {
      ok: false,
      id: 'verification-evidence:store-root-invalid'
    };
  }
  const changeReal = existingRealpath(changeLexical);
  if (!changeReal) {
    return {
      ok: false,
      id: 'verification-evidence:change-root-missing'
    };
  }
  const relative = path.relative(changeLexical, rootLexical);
  let current = changeLexical;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return {
        ok: false,
        id: 'verification-evidence:store-root-invalid'
      };
    }
    if (stat.isSymbolicLink()) {
      return {
        ok: false,
        id: 'verification-evidence:store-root-symlink'
      };
    }
    const currentReal = existingRealpath(current);
    if (!currentReal || !isContained(changeReal, currentReal)) {
      return {
        ok: false,
        id: 'verification-evidence:store-root-outside-change'
      };
    }
  }
  return {
    ok: true,
    change_lexical: changeLexical,
    change_real: changeReal,
    root: rootLexical
  };
}

function ensureSafeDirectory(rootState, target) {
  const targetPath = path.resolve(target);
  if (!isContained(rootState.change_lexical, targetPath)) {
    throw new Error('verification-evidence:store-root-outside-change');
  }
  const relative = path.relative(rootState.change_lexical, targetPath);
  let current = rootState.change_lexical;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error('verification-evidence:store-root-symlink');
    }
    if (!stat.isDirectory()) {
      throw new Error('verification-evidence:store-root-invalid');
    }
    const currentReal = fs.realpathSync(current);
    if (!isContained(rootState.change_real, currentReal)) {
      throw new Error('verification-evidence:store-root-outside-change');
    }
  }
  return targetPath;
}

function validateSourcePath(sourceRoot, sourcePath) {
  if (typeof sourceRoot !== 'string' || typeof sourcePath !== 'string') {
    return {
      ok: false,
      id: 'verification-evidence:source-missing'
    };
  }
  const sourceRootLexical = path.resolve(sourceRoot);
  const sourceRootReal = existingRealpath(sourceRootLexical);
  if (!sourceRootReal) {
    return {
      ok: false,
      id: 'verification-evidence:source-root-missing'
    };
  }
  const candidate = path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(sourceRootLexical, sourcePath);
  if (!isContained(sourceRootLexical, candidate)) {
    return {
      ok: false,
      id: 'verification-evidence:source-path-outside-root'
    };
  }
  if (!fs.existsSync(candidate)) {
    return {
      ok: false,
      id: 'verification-evidence:source-missing'
    };
  }

  const relative = path.relative(sourceRootLexical, candidate);
  let current = sourceRootLexical;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      return {
        ok: false,
        id: 'verification-evidence:source-path-symlink'
      };
    }
  }

  const stat = fs.statSync(candidate);
  if (!stat.isFile()) {
    return {
      ok: false,
      id: 'verification-evidence:source-not-regular-file'
    };
  }
  const real = existingRealpath(candidate);
  if (!real || !isContained(sourceRootReal, real)) {
    return {
      ok: false,
      id: 'verification-evidence:source-path-outside-root'
    };
  }
  return {
    ok: true,
    path: candidate,
    realpath: real
  };
}

module.exports = {
  isContained,
  validateStoreRoot,
  ensureSafeDirectory,
  validateSourcePath
};
