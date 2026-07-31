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

function revalidateStoreRoot(rootState, root) {
  if (
    !rootState
    || typeof rootState !== 'object'
    || typeof rootState.change_lexical !== 'string'
    || typeof rootState.change_real !== 'string'
  ) {
    return {
      ok: false,
      id: 'verification-evidence:store-root-invalid'
    };
  }
  const active = validateStoreRoot(rootState.change_lexical, root);
  if (!active.ok) return active;
  if (active.change_real !== rootState.change_real) {
    return {
      ok: false,
      id: 'verification-evidence:store-root-outside-change'
    };
  }
  return active;
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

function validateResolvedStorePath(rootState, root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  if (!isContained(rootPath, targetPath)) {
    return {
      ok: false,
      id: 'verification-evidence:object-path-unsafe'
    };
  }
  const relative = path.relative(rootState.change_lexical, targetPath);
  let current = rootState.change_lexical;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      return {
        ok: false,
        id: 'verification-evidence:object-path-unsafe'
      };
    }
    if (stat.isSymbolicLink()) {
      return {
        ok: false,
        id: 'verification-evidence:object-path-unsafe'
      };
    }
    const real = existingRealpath(current);
    if (!real || !isContained(rootState.change_real, real)) {
      return {
        ok: false,
        id: 'verification-evidence:object-path-unsafe'
      };
    }
  }
  return {
    ok: true,
    path: targetPath
  };
}

function readStoreFile(rootState, root, target) {
  const activeRoot = revalidateStoreRoot(rootState, root);
  if (!activeRoot.ok) return activeRoot;
  const targetPath = path.resolve(target);
  const resolvedPath = validateResolvedStorePath(
    activeRoot,
    root,
    targetPath
  );
  if (!resolvedPath.ok) {
    return {
      ok: false,
      id: 'verification-evidence:store-file-path-unsafe'
    };
  }

  let fd;
  try {
    fd = fs.openSync(
      targetPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    const openedStat = fs.fstatSync(fd);
    if (!openedStat.isFile()) {
      return {
        ok: false,
        id: 'verification-evidence:store-file-path-unsafe'
      };
    }

    const currentRoot = revalidateStoreRoot(rootState, root);
    if (!currentRoot.ok) return currentRoot;
    const currentPath = validateResolvedStorePath(
      currentRoot,
      root,
      targetPath
    );
    if (!currentPath.ok) {
      return {
        ok: false,
        id: 'verification-evidence:store-file-path-unsafe'
      };
    }
    const currentStat = fs.lstatSync(targetPath);
    if (
      currentStat.isSymbolicLink()
      || !currentStat.isFile()
      || currentStat.dev !== openedStat.dev
      || currentStat.ino !== openedStat.ino
    ) {
      return {
        ok: false,
        id: 'verification-evidence:store-file-path-unsafe'
      };
    }
    return {
      ok: true,
      bytes: fs.readFileSync(fd),
      missing: false
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ok: true,
        bytes: Buffer.alloc(0),
        missing: true
      };
    }
    return {
      ok: false,
      id: error?.code === 'ELOOP'
        ? 'verification-evidence:store-file-path-unsafe'
        : 'verification-evidence:store-file-read-failed',
      error
    };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // The primary read result remains authoritative.
      }
    }
  }
}

module.exports = {
  isContained,
  validateStoreRoot,
  revalidateStoreRoot,
  ensureSafeDirectory,
  validateSourcePath,
  validateResolvedStorePath,
  readStoreFile
};
