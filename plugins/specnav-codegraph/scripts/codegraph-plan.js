#!/usr/bin/env node
'use strict';

const planner = require('../core/codegraph-claim-planner');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function main(argv = process.argv.slice(2)) {
  if (hasFlag(argv, '--help')) {
    process.stdout.write('Usage: codegraph-plan.js [--project <dir>] [--change <id>] [--stage development|verification|operations|all] [--write] [--json]\n');
    return 0;
  }
  const result = planner.plan({
    projectRoot: argValue(argv, '--project', null),
    change: argValue(argv, '--change', null),
    stage: argValue(argv, '--stage', 'development'),
    write: hasFlag(argv, '--write')
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = {
  main,
  plan: planner.plan
};
