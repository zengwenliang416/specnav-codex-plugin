#!/usr/bin/env node
'use strict';

const builder = require('../core/codegraph-context-builder');

function main(argv = process.argv.slice(2)) {
  return builder.main(argv);
}

if (require.main === module) process.exit(main());

module.exports = {
  main,
  build: builder.build
};
