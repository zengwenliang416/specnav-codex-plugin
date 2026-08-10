'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HELPER = path.join(__dirname, 'safe-filesystem.py');
const PYTHON = '/usr/bin/python3';
const MAX_OUTPUT = 256 * 1024 * 1024;

function trustedPython() {
  let real;
  let stat;
  try {
    real = fs.realpathSync(PYTHON);
    stat = fs.statSync(real);
  } catch {
    throw new Error('verification-operations:safe-fs-python-unavailable');
  }
  if (
    !real.startsWith('/usr/bin/')
    || !stat.isFile()
    || (stat.mode & 0o022) !== 0
    || typeof stat.uid === 'number' && stat.uid !== 0
  ) {
    throw new Error('verification-operations:safe-fs-python-untrusted');
  }
  return real;
}

function invoke(request) {
  const result = childProcess.spawnSync(trustedPython(), [HELPER], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT,
    env: {
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin'
    }
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

function atomicCompareAndSwapFile(root, file, bytes, expectedBytes, blockerId) {
  if (expectedBytes !== null && !Buffer.isBuffer(expectedBytes)) {
    throw new TypeError('verification-operations:safe-fs-expected-invalid');
  }
  const relative = path.relative(root, file).split(path.sep).join('/');
  const request = {
    action: 'atomic_write',
    root: path.resolve(root),
    relative,
    blocker_id: blockerId,
    data_base64: Buffer.from(bytes).toString('base64'),
    expected_exists: expectedBytes !== null
  };
  if (expectedBytes !== null) {
    request.expected_base64 = expectedBytes.toString('base64');
  }
  return invoke(request);
}

function atomicCompareAndSwapJson(root, file, value, expectedBytes, blockerId) {
  return atomicCompareAndSwapFile(
    root,
    file,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
    expectedBytes,
    blockerId
  );
}

function appendJsonl(root, file, value, blockerId) {
  const line = JSON.stringify(value);
  if (line === undefined) {
    throw new TypeError('verification-operations:jsonl-record-invalid');
  }
  const relative = path.relative(root, file).split(path.sep).join('/');
  return invoke({
    action: 'append_jsonl',
    root: path.resolve(root),
    relative,
    blocker_id: blockerId,
    data_base64: Buffer.from(`${line}\n`).toString('base64')
  });
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
  atomicCompareAndSwapFile,
  atomicCompareAndSwapJson,
  atomicWriteFile,
  atomicWriteJson,
  appendJsonl,
  copyTree,
  createLock,
  listDirectory,
  readRegularFile,
  releaseLock,
  removeRegularFile,
  removeTree
};
