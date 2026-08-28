#!/usr/bin/env node
'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const {
  validateDevelopment
} = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/development-contract'
));
const {
  createValidationReceiptAuthority
} = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/development-receipt-authority'
));

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

const args = process.argv.slice(2);
const projectRoot = path.resolve(argValue(args, '--project', process.cwd()));
const mode = argValue(args, '--mode', 'handoff');
const receiptAuthority = createValidationReceiptAuthority({
  key: Buffer.alloc(32, 29),
  authorityDigest: 'd'.repeat(64)
});
const result = validateDevelopment(projectRoot, {
  mode,
  receiptAuthority
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 2);
