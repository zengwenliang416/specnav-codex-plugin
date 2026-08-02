'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ioDetail(error, target) {
  const code = typeof error?.code === 'string' ? error.code : 'ERROR';
  const message = error instanceof Error ? error.message : String(error);
  return `${code}: ${message}; target=${target}`;
}

function validateRoot(changeRoot, root) {
  try {
    const resolvedChange = path.resolve(changeRoot);
    const canonicalChange = fs.realpathSync(changeRoot);
    const resolvedRoot = path.resolve(root);
    if (!isContained(resolvedChange, resolvedRoot)) {
      throw new Error('outside-change');
    }
    fs.mkdirSync(resolvedRoot, { recursive: true });
    const canonicalRoot = fs.realpathSync(resolvedRoot);
    const stat = fs.lstatSync(canonicalRoot);
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || !isContained(canonicalChange, canonicalRoot)
    ) {
      throw new Error('unsafe-root');
    }
    return {
      ok: true,
      changeRoot: canonicalChange,
      root: canonicalRoot,
      blockers: []
    };
  } catch (error) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-persistence:root-invalid',
        root,
        ioDetail(error, root)
      )]
    };
  }
}

function resolveTarget(config, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || path.isAbsolute(relativePath)
    || relativePath.includes('\0')
  ) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-persistence:path-invalid',
        relativePath || 'artifact'
      )]
    };
  }
  const target = path.resolve(config.root, relativePath);
  if (!isContained(config.root, target)) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-persistence:path-outside-root',
        relativePath
      )]
    };
  }
  let current = path.dirname(target);
  while (isContained(config.root, current) && current !== config.root) {
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        return {
          ok: false,
          blockers: [blocker(
            'verification-persistence:path-unsafe',
            relativePath
          )]
        };
      }
    }
    current = path.dirname(current);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-persistence:path-unsafe',
        relativePath
      )]
    };
  }
  return { ok: true, target, blockers: [] };
}

function ensureDirectory(config, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const canonical = fs.realpathSync(path.dirname(target));
  if (!isContained(config.root, canonical)) {
    throw new Error('directory-outside-root');
  }
}

function writeAtomic(config, target, bytes) {
  ensureDirectory(config, target);
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, target);
    return { ok: true, path: target, blockers: [] };
  } catch (error) {
    try {
      if (fd !== undefined) fs.closeSync(fd);
    } catch {
      // Preserve the primary failure.
    }
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Preserve the primary failure.
    }
    return {
      ok: false,
      blockers: [blocker(
        'verification-persistence:atomic-write-failed',
        target,
        ioDetail(error, target)
      )]
    };
  }
}

function createVerificationArtifactStore(options = {}) {
  const config = validateRoot(options.changeRoot, options.root);

  function failed() {
    return config.ok ? null : config;
  }

  function publishJson(relativePath, value) {
    const invalid = failed();
    if (invalid) return invalid;
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    let bytes;
    try {
      bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:json-invalid',
          relativePath,
          error instanceof Error ? error.message : String(error)
        )]
      };
    }
    return writeAtomic(config, resolved.target, bytes);
  }

  function publishText(relativePath, value) {
    const invalid = failed();
    if (invalid) return invalid;
    if (typeof value !== 'string') {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:text-invalid',
          relativePath
        )]
      };
    }
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    return writeAtomic(config, resolved.target, Buffer.from(value));
  }

  function publishImmutableJson(relativePath, value) {
    const invalid = failed();
    if (invalid) return invalid;
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    let bytes;
    try {
      bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      ensureDirectory(config, resolved.target);
      const fd = fs.openSync(resolved.target, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true, path: resolved.target, blockers: [] };
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          error?.code === 'EEXIST'
            ? 'verification-persistence:immutable-conflict'
            : 'verification-persistence:immutable-write-failed',
          relativePath,
          ioDetail(error, resolved.target)
        )]
      };
    }
  }

  function appendJsonl(relativePath, records) {
    const invalid = failed();
    if (invalid) return invalid;
    const values = Array.isArray(records) ? records : [records];
    if (values.length === 0) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:append-empty',
          relativePath
        )]
      };
    }
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    let bytes;
    try {
      bytes = Buffer.from(
        `${values.map((value) => JSON.stringify(value)).join('\n')}\n`
      );
      ensureDirectory(config, resolved.target);
      const fd = fs.openSync(
        resolved.target,
        fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY,
        0o600
      );
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true, path: resolved.target, blockers: [] };
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:append-failed',
          relativePath,
          ioDetail(error, resolved.target)
        )]
      };
    }
  }

  function readJson(relativePath) {
    const invalid = failed();
    if (invalid) return invalid;
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    try {
      return {
        ok: true,
        value: JSON.parse(fs.readFileSync(resolved.target, 'utf8')),
        path: resolved.target,
        blockers: []
      };
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:json-read-failed',
          relativePath,
          ioDetail(error, resolved.target)
        )]
      };
    }
  }

  return Object.freeze({
    appendJsonl,
    publishImmutableJson,
    publishJson,
    publishText,
    readJson,
    root: config.ok ? config.root : null
  });
}

module.exports = {
  createVerificationArtifactStore,
  isContained,
  validateRoot
};
