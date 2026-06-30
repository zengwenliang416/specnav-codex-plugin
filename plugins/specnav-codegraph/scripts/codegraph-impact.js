#!/usr/bin/env node
'use strict';

const builder = require('../core/codegraph-context-builder');

function rewriteArgs(argv) {
  return argv.includes('--stage') ? argv : ['--stage', 'operations', ...argv];
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: codegraph-impact.js --query "impact question" [--project <dir>] [--change <id>] [--write] [--json]\n');
    return 0;
  }
  return builder.main(rewriteArgs(argv));
}

if (require.main === module) process.exit(main());

module.exports = { main };
