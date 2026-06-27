#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const COMMANDS = new Set(['resolve', 'env']);

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function envName(pluginName) {
  const normalized = pluginName.startsWith('specnav-') ? pluginName.slice('specnav-'.length) : pluginName;
  return `SPECNAV_${normalized.replace(/-/g, '_').toUpperCase()}_ROOT`;
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, status: 'missing' };
    if (error instanceof SyntaxError) return { ok: false, status: 'malformed' };
    return { ok: false, status: 'unreadable' };
  }
}

function findCurrentPluginRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.codex-plugin', 'plugin.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function installedMarketplaceRootFromCurrent() {
  const currentPluginRoot = findCurrentPluginRoot(__dirname);
  if (!currentPluginRoot) return null;
  const versionDir = path.dirname(currentPluginRoot);
  const pluginDir = path.dirname(versionDir);
  const marketplaceRoot = path.dirname(pluginDir);
  if (path.basename(marketplaceRoot) !== 'specnav-marketplace') return null;
  if (!marketplaceRoot.split(path.sep).includes('cache')) return null;
  return marketplaceRoot;
}

function sourceMarketplaceRootFromCurrent() {
  const currentPluginRoot = findCurrentPluginRoot(__dirname);
  if (!currentPluginRoot) return null;
  const repoRoot = path.resolve(currentPluginRoot, '../..');
  if (fs.existsSync(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'))) return repoRoot;
  return null;
}

function defaultMarketplaceRoot() {
  return path.resolve(
    process.env.SPECNAV_MARKETPLACE_ROOT
      || sourceMarketplaceRootFromCurrent()
      || installedMarketplaceRootFromCurrent()
      || path.join(os.homedir(), '.codex', 'plugins', 'cache', 'specnav-marketplace')
  );
}

function versionSort(a, b) {
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(b, a);
}

function isActivePluginRoot(root, pluginName) {
  if (!root || fs.existsSync(path.join(root, '.orphaned_at'))) return false;
  const pluginJson = readJson(path.join(root, '.codex-plugin', 'plugin.json'));
  return !!(
    pluginJson.ok
    && pluginJson.value
    && typeof pluginJson.value === 'object'
    && !Array.isArray(pluginJson.value)
    && pluginJson.value.name === pluginName
  );
}

function resolveSourcePlugin(marketplaceRoot, pluginName) {
  const root = path.join(marketplaceRoot, 'plugins', pluginName);
  return isActivePluginRoot(root, pluginName) ? root : null;
}

function resolveInstalledPlugin(marketplaceRoot, pluginName) {
  const pluginBase = path.join(marketplaceRoot, pluginName);
  let entries;
  try {
    entries = fs.readdirSync(pluginBase, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ version: entry.name, root: path.join(pluginBase, entry.name) }))
    .sort((a, b) => versionSort(a.version, b.version))
    .map((candidate) => candidate.root)
    .find((root) => isActivePluginRoot(root, pluginName)) || null;
}

function resolvePluginRoot(marketplaceRoot, pluginName) {
  return resolveSourcePlugin(marketplaceRoot, pluginName) || resolveInstalledPlugin(marketplaceRoot, pluginName);
}

function parseArgs(args) {
  let command = null;
  const plugins = [];
  const blockers = [];
  let marketplaceRoot = null;
  let shell = false;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--shell') {
      shell = true;
      continue;
    }
    if (arg === '--plugin' || arg === '--marketplace-root') {
      const value = args[i + 1];
      if (!isNonEmpty(value) || value.startsWith('--')) {
        blockers.push(`missing-argument:${arg}`);
        continue;
      }
      if (arg === '--plugin') plugins.push(value);
      else if (marketplaceRoot) blockers.push('duplicate-argument:--marketplace-root');
      else marketplaceRoot = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      blockers.push(`unknown-argument:${arg}`);
      if (isNonEmpty(args[i + 1]) && !args[i + 1].startsWith('--')) i += 1;
      continue;
    }
    if (!command) {
      command = arg;
      continue;
    }
    blockers.push(`unknown-command:${arg}`);
  }

  command = command || 'resolve';
  if (!COMMANDS.has(command)) blockers.push(`unknown-command:${command}`);
  if (!plugins.length) blockers.push('missing-argument:--plugin');
  if (command === 'env' && !shell && !json) json = true;

  return {
    command,
    plugins,
    marketplaceRoot: marketplaceRoot ? path.resolve(marketplaceRoot) : defaultMarketplaceRoot(),
    shell,
    json,
    blockers: unique(blockers)
  };
}

function resolveRuntime(options) {
  const plugins = options.plugins.map((pluginName) => {
    const valid = /^[a-z0-9-]+$/.test(pluginName || '');
    const root = valid ? resolvePluginRoot(options.marketplaceRoot, pluginName) : null;
    return {
      name: pluginName,
      root,
      env: valid ? envName(pluginName) : null,
      blockers: valid ? (root ? [] : [`missing-plugin:${pluginName}`]) : [`invalid-plugin-name:${pluginName || ''}`]
    };
  });
  const blockers = unique([
    ...options.blockers,
    ...plugins.flatMap((plugin) => plugin.blockers)
  ]);
  return {
    ok: blockers.length === 0,
    marketplace_root: options.marketplaceRoot,
    plugins,
    blockers
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function toShell(result) {
  const lines = [];
  lines.push(`SPECNAV_MARKETPLACE_ROOT=${shellQuote(result.marketplace_root)}`);
  for (const plugin of result.plugins) {
    if (plugin.env && plugin.root) lines.push(`${plugin.env}=${shellQuote(plugin.root)}`);
  }
  const exports = ['SPECNAV_MARKETPLACE_ROOT', ...result.plugins.map((plugin) => plugin.env).filter(Boolean)];
  lines.push(`export ${unique(exports).join(' ')}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const result = resolveRuntime(cli);
  if (cli.command === 'env' && cli.shell && !cli.json) {
    if (result.ok) process.stdout.write(toShell(result));
    else process.stderr.write(`${result.blockers.join('\n')}\n`);
  } else {
    const output = cli.command === 'env' && cli.shell
      ? { ...result, shell: result.ok ? toShell(result) : '' }
      : result;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  defaultMarketplaceRoot,
  envName,
  resolveRuntime,
  resolvePluginRoot,
  toShell
};
