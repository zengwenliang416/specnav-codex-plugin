'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

const HELPER = path.join(__dirname, 'safe-filesystem.py');
const MAX_OUTPUT = 256 * 1024 * 1024;

function invoke(request) {
  const python = process.env.SPECNAV_PYTHON_BIN || 'python3';
  const result = childProcess.spawnSync(python, [HELPER], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT,
    env: process.env
  });
  if (result.error) {
    const id = result.error.code === 'ENOENT'
      ? 'verification-operations:safe-fs-python-unavailable'
      : 'verification-operations:safe-fs-process-failed';
    throw new Error(id);
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error('verification-operations:safe-fs-output-invalid');
  }
  if (result.status !== 0 || payload.ok !== true) {
    throw new Error(
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : 'verification-operations:safe-fs-failed'
    );
  }
  return payload;
}

function readRegularFile(root, file, blockerId, optional = false) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const result = invoke({
    action: 'read_file',
    root: path.resolve(root),
    relative,
    blocker_id: blockerId,
    optional
  });
  return result.exists
    ? Buffer.from(result.data_base64, 'base64')
    : null;
}

function atomicWriteFile(root, file, bytes, blockerId, exclusive = false) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  return invoke({
    action: 'atomic_write',
    root: path.resolve(root),
    relative,
    blocker_id: blockerId,
    data_base64: Buffer.from(bytes).toString('base64'),
    exclusive
  });
}

function atomicWriteJson(root, file, value, blockerId, exclusive = false) {
  return atomicWriteFile(
    root,
    file,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
    blockerId,
    exclusive
  );
}

function removeRegularFile(root, file, blockerId, optional = false) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  return invoke({
    action: 'remove_file',
    root: path.resolve(root),
    relative,
    blocker_id: blockerId,
    optional
  });
}

function copyTree(sourceRoot, sourceRelative, targetRoot, targetRelative, blockerId) {
  return invoke({
    action: 'copy_tree',
    source_root: path.resolve(sourceRoot),
    source_relative: sourceRelative,
    target_root: path.resolve(targetRoot),
    target_relative: targetRelative,
    blocker_id: blockerId
  });
}

function removeTree(root, relative, blockerId, allowLeafSymlink = false) {
  return invoke({
    action: 'remove_tree',
    root: path.resolve(root),
    relative,
    blocker_id: blockerId,
    allow_leaf_symlink: allowLeafSymlink
  });
}

function listDirectory(root, relative, blockerId) {
  return invoke({
    action: 'list_directory',
    root: path.resolve(root),
    relative,
    blocker_id: blockerId
  }).entries;
}

function createLock(root, relative, token, blockerId) {
  return invoke({
    action: 'create_lock',
    root: path.resolve(root),
    relative,
    token,
    blocker_id: blockerId
  });
}

function releaseLock(root, relative, token, blockerId) {
  return invoke({
    action: 'release_lock',
    root: path.resolve(root),
    relative,
    token,
    blocker_id: blockerId
  });
}

module.exports = {
  atomicWriteFile,
  atomicWriteJson,
  copyTree,
  createLock,
  listDirectory,
  readRegularFile,
  releaseLock,
  removeRegularFile,
  removeTree
};
