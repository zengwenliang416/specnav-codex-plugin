#!/usr/bin/env node
'use strict';

const path = require('node:path');

const {
  REPORT_PATHS,
  SCHEMA,
  createProcessExecutor,
  createVerificationHostAdapter,
  parseCli,
  runHostCli
} = require('./host-verification-adapter');

const HOST = 'codex';
const BLOCKER_PREFIX = 'codex-verification';

function createCodexVerificationAdapter(options = {}) {
  return createVerificationHostAdapter({
    ...options,
    host: HOST,
    blockerPrefix: BLOCKER_PREFIX
  });
}

function main() {
  const result = runHostCli({
    host: HOST,
    blockerPrefix: BLOCKER_PREFIX,
    pluginRoot: path.resolve(__dirname, '..')
  });
  process.exit(result.exitStatus);
}

if (require.main === module) main();

module.exports = {
  REPORT_PATHS,
  SCHEMA,
  createCodexVerificationAdapter,
  createProcessExecutor,
  main,
  parseCli
};
