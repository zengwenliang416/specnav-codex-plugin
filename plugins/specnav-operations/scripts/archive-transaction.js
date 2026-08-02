'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const safeFs = require('./safe-filesystem');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function relative(root, target, blockerId) {
  const value = path.relative(path.resolve(root), path.resolve(target))
    .split(path.sep)
    .join('/');
  if (
    value === ''
    || value === '..'
    || value.startsWith('../')
  ) {
    throw new Error(`${blockerId}:path-escape`);
  }
  return value;
}

function readRegularFile(root, file, blockerId, optional = false) {
  return safeFs.readRegularFile(root, file, blockerId, optional);
}

function atomicWriteFile(root, file, bytes, blockerId, exclusive = false) {
  return safeFs.atomicWriteFile(
    root,
    file,
    bytes,
    blockerId,
    exclusive
  );
}

function atomicWriteJson(root, file, value, blockerId, exclusive = false) {
  return safeFs.atomicWriteJson(
    root,
    file,
    value,
    blockerId,
    exclusive
  );
}

function removeRegularFile(root, file, blockerId, optional = false) {
  return safeFs.removeRegularFile(root, file, blockerId, optional);
}

function archiveInventory(root, change) {
  const archiveRoot = path.join(root, 'openspec', 'changes', 'archive');
  if (!fs.existsSync(archiveRoot)) {
    return { archiveRoot, names: [], safe: [], unsafe: [] };
  }
  const entries = safeFs.listDirectory(
    root,
    'openspec/changes/archive',
    'verification-operations:archive-root-unsafe'
  );
  const names = [];
  const safe = [];
  const unsafe = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(`-${change}`)) continue;
    names.push(entry.name);
    const absolute = path.join(archiveRoot, entry.name);
    if (entry.kind === 'directory') {
      safe.push(absolute);
    } else {
      unsafe.push(absolute);
    }
  }
  return {
    archiveRoot,
    names: names.sort(),
    safe: safe.sort(),
    unsafe: unsafe.sort()
  };
}

function captureEvidence(changeDir) {
  const files = [
    'verify/evidence/raw.jsonl',
    'verify/evidence/index.json',
    'verify/evidence-index.jsonl'
  ];
  return files.flatMap((entry) => {
    const file = path.join(changeDir, entry);
    let bytes;
    try {
      bytes = readRegularFile(
        changeDir,
        file,
        `verification-operations:archive-evidence:${entry}`,
        true
      );
    } catch (error) {
      if (
        error?.message?.includes(':symlink')
        || error?.message?.includes(':root-changed')
      ) {
        throw new Error(`verification-operations:archive-evidence-symlink:${entry}`);
      }
      throw new Error(`verification-operations:archive-evidence-unreadable:${entry}`);
    }
    return bytes ? [{ path: entry, sha256: sha256(bytes) }] : [];
  });
}

function verifyEvidence(archiveDir, captured) {
  const files = [];
  const blockers = [];
  for (const entry of captured) {
    const file = path.join(archiveDir, entry.path);
    let bytes;
    try {
      bytes = readRegularFile(
        archiveDir,
        file,
        `verification-operations:archive-evidence:${entry.path}`
      );
    } catch (error) {
      blockers.push(
        error?.message?.includes(':symlink')
        || error?.message?.includes(':root-changed')
          ? `verification-operations:archive-evidence-symlink:${entry.path}`
          : `verification-operations:archive-evidence-missing:${entry.path}`
      );
      continue;
    }
    const digest = sha256(bytes);
    files.push({ path: entry.path, sha256: digest });
    if (digest !== entry.sha256) {
      blockers.push(`verification-operations:archive-evidence-mutation:${entry.path}`);
    }
  }
  return {
    ok: blockers.length === 0,
    immutable: true,
    files,
    blockers
  };
}

function snapshotFile(root, file, blockerId) {
  const bytes = readRegularFile(root, file, blockerId, true);
  return { file, existed: bytes !== null, bytes };
}

function restoreFile(root, snapshot, blockerId) {
  if (snapshot.existed) {
    atomicWriteFile(root, snapshot.file, snapshot.bytes, blockerId);
    return;
  }
  removeRegularFile(root, snapshot.file, blockerId, true);
}

function specTargets(changeDir, change) {
  const targets = new Set([change]);
  const source = path.join(changeDir, 'specs');
  if (!fs.existsSync(source)) return [...targets].sort();
  for (const entry of safeFs.listDirectory(
    changeDir,
    'specs',
    'verification-operations:archive-spec-targets-unsafe'
  )) {
    if (entry.kind !== 'directory') {
      throw new Error('verification-operations:archive-spec-targets-unsafe');
    }
    targets.add(entry.name);
  }
  return [...targets].sort();
}

function snapshotSpecTargets(root, changeDir, change, temporaryRoot) {
  const targets = specTargets(changeDir, change);
  const snapshots = [];
  for (const target of targets) {
    const source = path.join(root, 'openspec', 'specs', target);
    if (!fs.existsSync(source)) {
      snapshots.push({ target, existed: false });
      continue;
    }
    safeFs.copyTree(
      root,
      `openspec/specs/${target}`,
      temporaryRoot,
      `specs/${target}`,
      'verification-operations:archive-specs-unsafe'
    );
    snapshots.push({ target, existed: true });
  }
  return snapshots;
}

function restoreSpecTargets(root, temporaryRoot, snapshots) {
  for (const snapshot of snapshots) {
    const targetRelative = `openspec/specs/${snapshot.target}`;
    const target = path.join(root, ...targetRelative.split('/'));
    if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
      safeFs.removeTree(
        root,
        targetRelative,
        'verification-operations:archive-rollback-specs',
        true
      );
    }
    if (snapshot.existed) {
      safeFs.copyTree(
        temporaryRoot,
        `specs/${snapshot.target}`,
        root,
        targetRelative,
        'verification-operations:archive-rollback-specs'
      );
    }
  }
}

function acquireLock(root) {
  const lockRelative = 'openspec/.specnav/archive.lock';
  const token = `${process.pid}:${crypto.randomBytes(16).toString('hex')}`;
  safeFs.createLock(
    root,
    lockRelative,
    token,
    'verification-operations:archive-lock'
  );
  return { relative: lockRelative, token };
}

function releaseLock(root, lock) {
  if (!lock) return;
  safeFs.releaseLock(
    root,
    lock.relative,
    lock.token,
    'verification-operations:archive-lock'
  );
}

function createArchiveTransaction(root, changeDir, change) {
  const lock = acquireLock(root);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-archive-'));
  let cleaned = false;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    releaseLock(root, lock);
  }

  let registry;
  let activeChange;
  let events;
  let beforeInventory;
  let specs;
  try {
    safeFs.copyTree(
      changeDir,
      '.',
      temporaryRoot,
      'change',
      'verification-operations:archive-source-unsafe'
    );
    specs = snapshotSpecTargets(root, changeDir, change, temporaryRoot);
    registry = snapshotFile(
      root,
      path.join(root, 'openspec', '.specnav', 'change-registry.json'),
      'verification-operations:archive-registry-unsafe'
    );
    activeChange = snapshotFile(
      root,
      path.join(root, 'openspec', '.specnav', 'active-change'),
      'verification-operations:archive-active-change-unsafe'
    );
    events = snapshotFile(
      root,
      path.join(root, 'openspec', '.specnav', 'events.jsonl'),
      'verification-operations:archive-events-unsafe'
    );
    beforeInventory = archiveInventory(root, change);
  } catch (error) {
    cleanup();
    throw error;
  }

  function rollback() {
    const blockers = [];
    function step(fn) {
      try {
        fn();
      } catch (error) {
        blockers.push(
          error instanceof Error
            ? error.message
            : 'verification-operations:archive-rollback-failed'
        );
      }
    }

    step(() => {
      const after = archiveInventory(root, change);
      const beforeNames = new Set(beforeInventory.names);
      for (const name of after.names.filter((entry) => !beforeNames.has(entry))) {
        safeFs.removeTree(
          root,
          `openspec/changes/archive/${name}`,
          'verification-operations:archive-rollback-output',
          true
        );
      }
    });
    step(() => {
      const sourceRelative = relative(
        root,
        changeDir,
        'verification-operations:archive-rollback-source'
      );
      const current = path.join(root, ...sourceRelative.split('/'));
      if (fs.existsSync(current) || fs.lstatSync(current, { throwIfNoEntry: false })) {
        safeFs.removeTree(
          root,
          sourceRelative,
          'verification-operations:archive-rollback-source',
          true
        );
      }
      safeFs.copyTree(
        temporaryRoot,
        'change',
        root,
        sourceRelative,
        'verification-operations:archive-rollback-source'
      );
    });
    step(() => restoreSpecTargets(root, temporaryRoot, specs));
    step(() => {
      restoreFile(
        root,
        registry,
        'verification-operations:archive-rollback-registry'
      );
    });
    step(() => {
      restoreFile(
        root,
        activeChange,
        'verification-operations:archive-rollback-active-change'
      );
    });
    step(() => {
      restoreFile(
        root,
        events,
        'verification-operations:archive-rollback-events'
      );
    });
    step(cleanup);
    return { ok: blockers.length === 0, blockers };
  }

  return {
    beforeInventory,
    cleanup,
    rollback
  };
}

module.exports = {
  archiveInventory,
  atomicWriteFile,
  atomicWriteJson,
  captureEvidence,
  createArchiveTransaction,
  readRegularFile,
  removeRegularFile,
  verifyEvidence
};
