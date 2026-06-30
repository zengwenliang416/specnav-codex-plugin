#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function printConfig(target) {
  if (target === 'codex') {
    return {
      target,
      config: '[mcp_servers.codegraph]\ncommand = "codegraph"\nargs = ["serve", "--mcp"]\n'
    };
  }
  return {
    target: 'claude',
    config: {
      mcpServers: {
        codegraph: {
          type: 'stdio',
          command: 'codegraph',
          args: ['serve', '--mcp']
        }
      },
      permissions: {
        allow: ['mcp__codegraph__*']
      }
    }
  };
}

function main(argv = process.argv.slice(2)) {
  if (hasFlag(argv, '--help')) {
    process.stdout.write('Usage: codegraph-setup.js --target claude|codex [--yes] [--json]\n');
    return 0;
  }
  const target = argValue(argv, '--target', 'claude');
  if (!['claude', 'codex'].includes(target)) {
    process.stdout.write(`${JSON.stringify({ ok: false, blockers: [`codegraph:invalid-target:${target}`] }, null, 2)}\n`);
    return 2;
  }
  if (!hasFlag(argv, '--yes')) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      target,
      blockers: ['codegraph:setup-confirmation-required'],
      config_preview: printConfig(target),
      message: 'Re-run with --yes to delegate to the official CodeGraph installer.'
    }, null, 2)}\n`);
    return 2;
  }
  const result = childProcess.spawnSync('codegraph', ['install', `--target=${target}`, '--yes'], {
    encoding: 'utf8',
    timeout: 120000
  });
  const ok = !result.error && result.status === 0;
  process.stdout.write(`${JSON.stringify({
    ok,
    target,
    blockers: ok ? ['codegraph:restart-required'] : ['codegraph:cli-missing'],
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null
  }, null, 2)}\n`);
  return ok ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = {
  main,
  printConfig
};
