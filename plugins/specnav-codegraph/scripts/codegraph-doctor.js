#!/usr/bin/env node
'use strict';

const statusManager = require('../core/codegraph-status-manager');

function main(argv = process.argv.slice(2)) {
  return statusManager.main(argv);
}

if (require.main === module) process.exit(main());

module.exports = {
  main,
  status: statusManager.status
};
