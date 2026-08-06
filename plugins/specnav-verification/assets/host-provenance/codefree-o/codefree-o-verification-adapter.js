#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const installedSharedAdapter = path.join(
  __dirname,
  'host-verification-adapter.js'
);
const sharedAdapterPath = fs.existsSync(installedSharedAdapter)
  ? installedSharedAdapter
  : path.resolve(
      __dirname,
      '../../plugins/specnav-verification/scripts/host-verification-adapter.js'
    );
const {
  REPORT_PATHS,
  SCHEMA,
  createProcessExecutor,
  createVerificationHostAdapter,
  parseCli,
  runHostCli
} = require(sharedAdapterPath);

const HOST = 'codefree-o';
const BLOCKER_PREFIX = 'codefree-o-verification';

function createCodeFreeOVerificationAdapter(options = {}) {
  return createVerificationHostAdapter({
    ...options,
    host: HOST,
    blockerPrefix: BLOCKER_PREFIX
  });
}

function main() {
  const pluginRoot = fs.existsSync(installedSharedAdapter)
    ? path.resolve(__dirname, '..')
    : path.resolve(__dirname, '../../plugins/specnav-verification');
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
  createCodeFreeOVerificationAdapter,
  createProcessExecutor,
  main,
  parseCli
};
