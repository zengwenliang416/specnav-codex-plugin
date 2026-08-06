'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson } = require('../evidence/identity');
const {
  readStoreFile,
  validateStoreRoot
} = require('../evidence/paths');

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
    const changeStat = fs.lstatSync(resolvedChange);
    if (changeStat.isSymbolicLink() || !changeStat.isDirectory()) {
      throw new Error('unsafe-change-root');
    }
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
    const rootState = validateStoreRoot(resolvedChange, resolvedRoot);
    if (!rootState.ok) {
      throw new Error(rootState.id);
    }
    return {
      ok: true,
      changeLexical: resolvedChange,
      changeRoot: canonicalChange,
      rootLexical: resolvedRoot,
      root: canonicalRoot,
      rootState,
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

function parseJsonl(bytes, relativePath) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes || '');
  if (bytes.length === 0) return [];
  const lines = bytes.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line, index) => {
    if (!line.trim()) {
      const error = new Error('empty-record');
      error.line = index + 1;
      throw error;
    }
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        const error = new Error('non-object-record');
        error.line = index + 1;
        throw error;
      }
      return value;
    } catch (error) {
      if (!error.line) error.line = index + 1;
      throw error;
    }
  });
}

function createVerificationArtifactStore(options = {}) {
  const config = validateRoot(options.changeRoot, options.root);
  const readRootState = config.ok ? config.rootState : null;

  function failed() {
    if (!config.ok) return config;
    let active;
    let currentRoot;
    try {
      active = validateStoreRoot(
        config.changeLexical,
        config.rootLexical
      );
      currentRoot = fs.realpathSync(config.rootLexical);
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:root-invalid',
          config.rootLexical,
          ioDetail(error, config.rootLexical)
        )]
      };
    }
    if (
      !active.ok
      || active.change_real !== readRootState.change_real
      || currentRoot !== config.root
    ) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:root-invalid',
          config.rootLexical,
          active.id || 'verification-evidence:store-root-changed'
        )]
      };
    }
    return null;
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
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      const fd = fs.openSync(
        resolved.target,
        fs.constants.O_CREAT
          | fs.constants.O_APPEND
          | fs.constants.O_WRONLY
          | noFollow,
        0o600
      );
      try {
        const opened = fs.fstatSync(fd);
        const current = fs.lstatSync(resolved.target);
        if (
          !opened.isFile()
          || current.isSymbolicLink()
          || !current.isFile()
          || opened.dev !== current.dev
          || opened.ino !== current.ino
        ) {
          throw new Error('append-target-changed');
        }
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

  function readBytes(relativePath) {
    const invalid = failed();
    if (invalid) return invalid;
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    const lexicalTarget = path.resolve(config.rootLexical, relativePath);
    const read = readStoreFile(
      readRootState,
      config.rootLexical,
      lexicalTarget
    );
    if (!read.ok) {
      return {
        ok: false,
        blockers: [blocker(
          read.id === 'verification-evidence:store-file-path-unsafe'
            ? 'verification-persistence:path-unsafe'
            : 'verification-persistence:read-failed',
          relativePath,
          read.error ? ioDetail(read.error, lexicalTarget) : null
        )]
      };
    }
    return {
      ok: true,
      bytes: read.bytes,
      missing: read.missing,
      path: lexicalTarget,
      blockers: []
    };
  }

  function readJson(relativePath) {
    const read = readBytes(relativePath);
    if (!read.ok) return read;
    if (read.missing) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:json-read-failed',
          relativePath,
          'ENOENT: artifact is missing'
        )]
      };
    }
    try {
      return {
        ok: true,
        value: JSON.parse(read.bytes.toString('utf8')),
        path: read.path,
        blockers: []
      };
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:json-read-failed',
          relativePath,
          ioDetail(error, read.path)
        )]
      };
    }
  }

  function readJsonl(relativePath) {
    const read = readBytes(relativePath);
    if (!read.ok) return read;
    if (read.missing) {
      return {
        ok: true,
        value: [],
        path: read.path,
        missing: true,
        blockers: []
      };
    }
    try {
      return {
        ok: true,
        value: parseJsonl(read.bytes, relativePath),
        path: read.path,
        missing: false,
        blockers: []
      };
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:jsonl-read-failed',
          relativePath,
          `line=${error.line || 'unknown'}; ${error.message}`
        )]
      };
    }
  }

  function listDirectory(relativePath) {
    const invalid = failed();
    if (invalid) return invalid;
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    try {
      const activeRoot = validateStoreRoot(config.changeRoot, config.root);
      if (!activeRoot.ok) {
        return {
          ok: false,
          blockers: [blocker(
            'verification-persistence:path-unsafe',
            relativePath,
            activeRoot.id
          )]
        };
      }
      if (!fs.existsSync(resolved.target)) {
        return {
          ok: true,
          entries: [],
          missing: true,
          path: resolved.target,
          blockers: []
        };
      }
      const directory = fs.lstatSync(resolved.target);
      const directoryReal = fs.realpathSync(resolved.target);
      if (
        directory.isSymbolicLink()
        || !directory.isDirectory()
        || !isContained(config.root, directoryReal)
      ) {
        return {
          ok: false,
          blockers: [blocker(
            'verification-persistence:path-unsafe',
            relativePath
          )]
        };
      }
      const entries = fs.readdirSync(resolved.target, {
        withFileTypes: true
      }).map((entry) => {
        const target = path.join(resolved.target, entry.name);
        const stat = fs.lstatSync(target);
        const real = fs.realpathSync(target);
        if (
          entry.isSymbolicLink()
          || stat.isSymbolicLink()
          || !isContained(config.root, real)
        ) {
          throw new Error(`unsafe-entry:${entry.name}`);
        }
        return {
          name: entry.name,
          type: entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : 'other'
        };
      }).sort((left, right) => left.name.localeCompare(right.name));
      return {
        ok: true,
        entries,
        missing: false,
        path: resolved.target,
        blockers: []
      };
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:directory-read-failed',
          relativePath,
          ioDetail(error, resolved.target)
        )]
      };
    }
  }

  function appendDerivedJsonl(relativePath, deriveRecord) {
    const invalid = failed();
    if (invalid) return invalid;
    if (typeof deriveRecord !== 'function') {
      return {
        ok: false,
        blockers: [blocker(
          'verification-persistence:append-deriver-invalid',
          relativePath
        )]
      };
    }
    const resolved = resolveTarget(config, relativePath);
    if (!resolved.ok) return resolved;
    try {
      ensureDirectory(config, resolved.target);
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
    const lockFile = `${resolved.target}.lock`;
    let lockFd;
    try {
      lockFd = fs.openSync(
        lockFile,
        fs.constants.O_CREAT
          | fs.constants.O_EXCL
          | fs.constants.O_WRONLY
          | (fs.constants.O_NOFOLLOW || 0),
        0o600
      );
      const existing = readJsonl(relativePath);
      if (!existing.ok) return existing;
      const record = deriveRecord(existing.value);
      if (
        !record
        || typeof record !== 'object'
        || Array.isArray(record)
        || typeof record.id !== 'string'
        || record.id.length === 0
      ) {
        return {
          ok: false,
          blockers: [blocker(
            'verification-persistence:append-record-invalid',
            relativePath
          )]
        };
      }
      const matches = existing.value.filter((entry) => entry.id === record.id);
      if (matches.length > 1) {
        return {
          ok: false,
          blockers: [blocker(
            'verification-persistence:append-log-duplicate',
            relativePath,
            record.id
          )]
        };
      }
      if (matches.length === 1) {
        if (canonicalJson(matches[0]) !== canonicalJson(record)) {
          return {
            ok: false,
            blockers: [blocker(
              'verification-persistence:append-log-conflict',
              relativePath,
              record.id
            )]
          };
        }
        return {
          ok: true,
          appended: false,
          value: matches[0],
          values: existing.value,
          path: resolved.target,
          blockers: []
        };
      }
      const appended = appendJsonl(relativePath, record);
      if (!appended.ok) return appended;
      return {
        ok: true,
        appended: true,
        value: record,
        values: [...existing.value, record],
        path: resolved.target,
        blockers: []
      };
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          error?.code === 'EEXIST'
            ? 'verification-persistence:append-lock-held'
            : 'verification-persistence:append-failed',
          relativePath,
          ioDetail(error, lockFile)
        )]
      };
    } finally {
      try {
        if (lockFd !== undefined) fs.closeSync(lockFd);
      } catch {
        // Preserve the primary result.
      }
      if (lockFd !== undefined) {
        try {
          fs.unlinkSync(lockFile);
        } catch {
          // A stale lock fails closed on the next mutation.
        }
      }
    }
  }

  function appendUniqueJsonl(relativePath, record) {
    return appendDerivedJsonl(relativePath, () => record);
  }

  return Object.freeze({
    appendDerivedJsonl,
    appendJsonl,
    appendUniqueJsonl,
    publishImmutableJson,
    publishJson,
    publishText,
    listDirectory,
    readBytes,
    readJson,
    readJsonl,
    root: config.ok ? config.root : null
  });
}

module.exports = {
  createVerificationArtifactStore,
  isContained,
  validateRoot
};
