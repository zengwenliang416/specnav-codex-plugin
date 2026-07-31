'use strict';

const fs = require('node:fs');
const path = require('node:path');

function blocker(id, artifact, detail = null) {
  return {
    id,
    artifact,
    detail
  };
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalPath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function validateApprovedCommand(testCase, command, projectRoot) {
  const runner = testCase.runner;
  const expectedArgv = [runner.entrypoint, ...runner.args];
  if (!sameStrings(command.argv, expectedArgv)) {
    return blocker(
      'verification-execution:command-argv-mismatch',
      testCase.id,
      'argv differs from the approved case snapshot'
    );
  }

  const expectedCwd = path.resolve(projectRoot, runner.cwd);
  if (!isContained(projectRoot, expectedCwd)) {
    return blocker(
      'verification-execution:command-cwd-outside-project',
      testCase.id,
      runner.cwd
    );
  }
  if (path.resolve(command.cwd) !== expectedCwd) {
    return blocker(
      'verification-execution:command-cwd-mismatch',
      testCase.id,
      `expected ${expectedCwd}; received ${command.cwd}`
    );
  }
  const canonicalRoot = canonicalPath(projectRoot);
  const canonicalCwd = canonicalPath(expectedCwd);
  if (!canonicalRoot || !canonicalCwd) {
    return blocker(
      'verification-execution:command-cwd-unresolvable',
      testCase.id,
      expectedCwd
    );
  }
  if (!isContained(canonicalRoot, canonicalCwd)) {
    return blocker(
      'verification-execution:command-cwd-outside-project',
      testCase.id,
      canonicalCwd
    );
  }

  const actualKeys = Object.keys(command.env).sort();
  const expectedKeys = [...runner.env_keys].sort();
  if (!sameStrings(actualKeys, expectedKeys)) {
    return blocker(
      'verification-execution:command-env-keys-mismatch',
      testCase.id,
      `expected ${expectedKeys.join(',')}; received ${actualKeys.join(',')}`
    );
  }
  return null;
}

module.exports = {
  canonicalPath,
  isContained,
  validateApprovedCommand
};
