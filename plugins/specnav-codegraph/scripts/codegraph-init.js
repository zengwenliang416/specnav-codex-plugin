#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const path = require('path');

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
    process.stdout.write('Usage: codegraph-init.js [--project <dir>] --yes [--json]\n');
    return 0;
  }
  const projectRoot = path.resolve(argValue(argv, '--project', process.env.PROJECT_DIR || process.cwd()));
  if (!hasFlag(argv, '--yes')) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      project_root: projectRoot,
      blockers: ['codegraph:init-confirmation-required'],
      message: 'Re-run with --yes to execute codegraph init in this project.'
    }, null, 2)}\n`);
    return 2;
  }
  const result = childProcess.spawnSync('codegraph', ['init'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 120000
  });
  const ok = !result.error && result.status === 0;
  process.stdout.write(`${JSON.stringify({
    ok,
    project_root: projectRoot,
    blockers: ok ? [] : ['codegraph:cli-missing'],
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null
  }, null, 2)}\n`);
  return ok ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = { main };
