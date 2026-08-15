#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The shared adapter ships beside this host adapter inside the same module.
// (The DeepSeek Harness suite has one layout, so there is no fallback path.)
const sharedAdapterPath = path.join(__dirname, 'host-verification-adapter.js');
const {
  REPORT_PATHS,
  SCHEMA,
  createProcessExecutor,
  createVerificationHostAdapter,
  parseCli,
  runHostCli
} = require(sharedAdapterPath);

const HOST = 'dsh';
const BLOCKER_PREFIX = 'dsh-verification';

function createDshVerificationAdapter(options = {}) {
  return createVerificationHostAdapter({
    ...options,
    host: HOST,
    blockerPrefix: BLOCKER_PREFIX
  });
}

function main() {
  const pluginRoot = path.resolve(__dirname, '..');
  const result = runHostCli({
    host: HOST,
    blockerPrefix: BLOCKER_PREFIX,
    pluginRoot
  });
  process.exit(result.exitStatus);
}

if (require.main === module) main();

module.exports = {
  REPORT_PATHS,
  SCHEMA,
  createDshVerificationAdapter,
  createProcessExecutor,
  main,
  parseCli
};
