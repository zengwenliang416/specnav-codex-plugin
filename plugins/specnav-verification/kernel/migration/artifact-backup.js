'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((segment) => (
      segment.length > 0 && segment !== '.' && segment !== '..'
    ));
}

function canonicalDirectory(root, id) {
  const resolved = path.resolve(root || '');
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return {
      ok: false,
      blockers: [blocker(id, resolved, 'directory-missing')]
    };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return {
      ok: false,
      blockers: [blocker(id, resolved, 'directory-unsafe')]
    };
  }
  return {
    ok: true,
    root: fs.realpathSync(resolved),
    blockers: []
  };
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function existingPathBlocker(root, target, symlinkId) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      return blocker(symlinkId, path.relative(root, current));
    }
  }
  return null;
}

function resolveContained(root, relativePath, options = {}) {
  if (!safeRelativePath(relativePath)) {
    return {
      ok: false,
      blockers: [blocker(
        options.pathBlocker || 'verification-migration:path-unsafe',
        relativePath || '<missing>'
      )]
    };
  }
  const target = path.resolve(root, relativePath);
  if (!inside(root, target)) {
    return {
      ok: false,
      blockers: [blocker(
        options.pathBlocker || 'verification-migration:path-unsafe',
        relativePath
      )]
    };
  }
  const symlink = existingPathBlocker(
    root,
    target,
    options.symlinkBlocker || 'verification-migration:path-symlink'
  );
  if (symlink) return { ok: false, blockers: [symlink] };
  if (options.mustExist) {
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch {
      return {
        ok: false,
        blockers: [blocker(
          options.missingBlocker || 'verification-migration:path-missing',
          relativePath
        )]
      };
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return {
        ok: false,
        blockers: [blocker(
          options.symlinkBlocker || 'verification-migration:path-symlink',
          relativePath,
          'regular-file-required'
        )]
      };
    }
    const real = fs.realpathSync(target);
    if (!inside(root, real)) {
      return {
        ok: false,
        blockers: [blocker(
          options.pathBlocker || 'verification-migration:path-unsafe',
          relativePath,
          'realpath-outside-root'
        )]
      };
    }
  }
  return { ok: true, target, blockers: [] };
}

function ensureDirectory(root, target) {
  if (!inside(root, target)) {
    throw new Error('verification-migration:write-path-unsafe');
  }
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('verification-migration:write-path-unsafe');
      }
      continue;
    }
    fs.mkdirSync(current, { mode: 0o700 });
  }
}

function writeExclusive(root, relativePath, bytes) {
  const resolved = resolveContained(root, relativePath, {
    pathBlocker: 'verification-migration:write-path-unsafe',
    symlinkBlocker: 'verification-migration:write-path-symlink'
  });
  if (!resolved.ok) {
    const error = new Error(resolved.blockers[0].id);
    error.blockers = resolved.blockers;
    throw error;
  }
  ensureDirectory(root, path.dirname(resolved.target));
  const parent = fs.realpathSync(path.dirname(resolved.target));
  if (!inside(root, parent)) {
    throw new Error('verification-migration:write-path-unsafe');
  }
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(resolved.target, flags, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    fs.rmSync(resolved.target, { force: true });
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  return resolved.target;
}

function readRegularFile(target) {
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(target, flags);
  try {
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error('verification-migration:regular-file-required');
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sourceArtifact(changeRoot, descriptor) {
  if (!descriptor || typeof descriptor !== 'object') {
    return {
      ok: false,
      blockers: [blocker(
        'verification-migration:artifact-invalid',
        'artifacts'
      )]
    };
  }
  const relativePath = descriptor.path;
  if (
    descriptor.kind === 'database'
    || descriptor.kind === 'sql'
    || /\.sql$/i.test(relativePath || '')
    || /^verify\/migration(?:\/|$)/.test(relativePath || '')
  ) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-migration:database-artifact-rejected',
        relativePath || '<missing>'
      )]
    };
  }
  const resolved = resolveContained(changeRoot, relativePath, {
    mustExist: true,
    pathBlocker: 'verification-migration:source-path-unsafe',
    symlinkBlocker: 'verification-migration:source-symlink',
    missingBlocker: 'verification-migration:source-missing'
  });
  if (!resolved.ok) return resolved;
  let bytes;
  try {
    bytes = readRegularFile(resolved.target);
  } catch (error) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-migration:source-read-failed',
        relativePath,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
  return {
    ok: true,
    relativePath,
    absolutePath: resolved.target,
    bytes,
    sha256: sha256(bytes),
    size: bytes.length,
    blockers: []
  };
}

function artifactRef(id, relativePath, bytes) {
  return {
    id,
    path: relativePath,
    sha256: sha256(bytes),
    size: bytes.length
  };
}

function backupManifest(migrationId, createdAt, sources) {
  const artifacts = sources.map((source, index) => {
    const backupPath = path.posix.join(
      'verify',
      'migration',
      'backups',
      migrationId,
      'artifacts',
      source.relativePath
    );
    return {
      source: {
        id: `source-${index + 1}`,
        path: source.relativePath,
        sha256: source.sha256,
        size: source.size
      },
      backup: {
        id: `backup-${index + 1}`,
        path: backupPath,
        sha256: source.sha256,
        size: source.size
      }
    };
  });
  return {
    artifact_kind: 'verification-migration-backup',
    format_version: 1,
    id: `${migrationId}-backup`,
    migration_id: migrationId,
    created_at: createdAt,
    artifacts
  };
}

function writeBackup(changeRoot, manifest, sources) {
  if (
    manifest?.artifact_kind !== 'verification-migration-backup'
    || manifest?.format_version !== 1
    || !Array.isArray(manifest?.artifacts)
    || manifest.artifacts.length !== sources.length
  ) {
    throw new Error('verification-migration:backup-manifest-invalid');
  }
  for (let index = 0; index < sources.length; index += 1) {
    const entry = manifest.artifacts[index];
    if (
      entry.source.sha256 !== sources[index].sha256
      || entry.source.size !== sources[index].size
      || entry.backup.sha256 !== sources[index].sha256
      || entry.backup.size !== sources[index].size
    ) {
      throw new Error('verification-migration:backup-manifest-invalid');
    }
    writeExclusive(
      changeRoot,
      entry.backup.path,
      sources[index].bytes
    );
  }
  const manifestPath = path.posix.join(
    'verify',
    'migration',
    'backups',
    manifest.migration_id,
    'manifest.json'
  );
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeExclusive(changeRoot, manifestPath, bytes);
  return artifactRef(`${manifest.migration_id}-backup-manifest`, manifestPath, bytes);
}

module.exports = {
  artifactRef,
  backupManifest,
  blocker,
  canonicalDirectory,
  readRegularFile,
  resolveContained,
  safeRelativePath,
  sha256,
  sourceArtifact,
  writeBackup,
  writeExclusive
};
