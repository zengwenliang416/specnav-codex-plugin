#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const COMMANDS = new Set(['list', 'resolve', 'require']);
const REQUIRED_SPECNAV_PLUGINS = [
  'specnav-core',
  'specnav-requirements',
  'specnav-prototype',
  'specnav-development',
  'specnav-verification',
  'specnav-operations',
  'specnav-codegraph'
];

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
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

function versionSort(a, b) {
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(b, a);
}

function valueBlocker(status, kind, name) {
  if (status === 'malformed') return `malformed-${kind}:${name}`;
  if (status === 'unreadable') return `unreadable-${kind}:${name}`;
  return `missing-${kind}:${name}`;
}

function marketplaceBlocker(status) {
  if (status === 'malformed') return 'malformed-marketplace-json';
  if (status === 'unreadable') return 'unreadable-marketplace-json';
  return 'missing-marketplace-json';
}

function findMarketplaceRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.agents', 'plugins', 'marketplace.json'))) return current;
    if (path.basename(current) === 'specnav-marketplace' && current.split(path.sep).includes('cache')) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveMarketplaceRoot(root) {
  return path.resolve(root || findMarketplaceRoot(process.cwd()) || path.resolve(__dirname, '../../..'));
}

function sourcePath(entry) {
  if (!entry || !isObject(entry)) return null;
  if (isNonEmpty(entry.source)) return entry.source.trim();
  if (isObject(entry.source) && isNonEmpty(entry.source.path)) return entry.source.path.trim();
  return null;
}

function isValidPluginMetadata(value) {
  return isObject(value)
    && isNonEmpty(value.name)
    && isNonEmpty(value.version)
    && isNonEmpty(value.skills);
}

function isValidStageManifest(value) {
  return isObject(value)
    && isNonEmpty(value.stage)
    && isNonEmpty(value.plugin)
    && (!Object.prototype.hasOwnProperty.call(value, 'required') || typeof value.required === 'boolean')
    && (!Object.prototype.hasOwnProperty.call(value, 'skills') || (
      Array.isArray(value.skills) && value.skills.every(isNonEmpty)
    ))
    && (!Object.prototype.hasOwnProperty.call(value, 'contracts') || isObject(value.contracts));
}

function latestInstalledRoot(marketplaceRoot, pluginName) {
  const pluginBase = path.join(marketplaceRoot, pluginName);
  let versions;
  try {
    versions = fs.readdirSync(pluginBase, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(versionSort);
  } catch {
    return null;
  }
  return versions.map((version) => path.join(pluginBase, version))
    .find((root) => fs.existsSync(path.join(root, '.codex-plugin', 'plugin.json'))) || null;
}

function stageData(root) {
  const stage = readJson(path.join(root, 'specnav-stage.json'));
  if (!stage.ok) return { ok: false, value: null, blocker: valueBlocker(stage.status, 'stage-manifest', path.basename(root)) };
  if (!isValidStageManifest(stage.value)) return { ok: false, value: stage.value, blocker: `invalid-stage-manifest:${stage.value && stage.value.plugin || path.basename(root)}` };
  return { ok: true, value: stage.value, blocker: null };
}

function pluginRecordFromRoot(name, root, source = null) {
  const manifest = readJson(path.join(root, '.codex-plugin', 'plugin.json'));
  const stage = stageData(root);
  const metadataValid = manifest.ok && isValidPluginMetadata(manifest.value);
  const nameMatches = metadataValid && manifest.value.name === name;
  const stageMatches = stage.ok && stage.value.plugin === name;
  const blockers = [
    manifest.ok ? (metadataValid ? null : `invalid-plugin-json:${name}`) : valueBlocker(manifest.status, 'plugin-json', name),
    metadataValid && !nameMatches ? `plugin-name-mismatch:${name}` : null,
    stage.blocker,
    stage.ok && !stageMatches ? `stage-plugin-mismatch:${name}` : null
  ];

  return {
    name,
    source,
    root,
    version: metadataValid ? manifest.value.version : null,
    stage: stage.ok ? stage.value.stage : null,
    required: !!(stage.ok && stage.value.required),
    skills: stage.ok ? (stage.value.skills || []) : [],
    contracts: stage.ok ? (stage.value.contracts || {}) : {},
    ok: unique(blockers).length === 0,
    blockers: unique(blockers)
  };
}

function loadMarketplace(root) {
  const marketplaceRoot = resolveMarketplaceRoot(root);
  const marketplaceFile = path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json');
  const marketplace = readJson(marketplaceFile);
  if (!marketplace.ok) return { ok: false, marketplaceRoot, blockers: [marketplaceBlocker(marketplace.status)] };
  if (!isObject(marketplace.value) || !Array.isArray(marketplace.value.plugins)) {
    return { ok: false, marketplaceRoot, blockers: ['invalid-marketplace-json'] };
  }
  return { ok: true, marketplaceRoot, marketplace: marketplace.value };
}

function listSourcePlugins(marketplaceRoot, marketplace) {
  const plugins = marketplace.plugins.map((entry, index) => {
    const name = isNonEmpty(entry && entry.name) ? entry.name.trim() : null;
    const source = sourcePath(entry);
    if (!name || !source) {
      return {
        name,
        source,
        root: source ? path.resolve(marketplaceRoot, source) : null,
        ok: false,
        blockers: [!name ? `missing-plugin-name:${index}` : `missing-plugin-source:${name}`]
      };
    }
    return pluginRecordFromRoot(name, path.resolve(marketplaceRoot, source), source);
  });
  const blockers = plugins.flatMap((plugin) => plugin.blockers);
  return {
    ok: blockers.length === 0,
    discovery: 'codex-marketplace-json',
    marketplace_root: marketplaceRoot,
    marketplace_name: marketplace.name || 'specnav-marketplace',
    blockers: unique(blockers),
    plugins
  };
}

function listInstalledCachePlugins(marketplaceRoot, marketplaceName = 'specnav-marketplace') {
  const plugins = REQUIRED_SPECNAV_PLUGINS.map((pluginName) => {
    const root = latestInstalledRoot(marketplaceRoot, pluginName);
    if (!root) {
      return {
        name: pluginName,
        source: null,
        root: null,
        ok: false,
        blockers: [`missing-installed-plugin:${pluginName}`],
        skills: [],
        contracts: {}
      };
    }
    return pluginRecordFromRoot(pluginName, root, root);
  });
  const blockers = plugins.flatMap((plugin) => plugin.blockers);
  return {
    ok: blockers.length === 0,
    discovery: 'codex-installed-cache',
    marketplace_root: marketplaceRoot,
    marketplace_name: marketplaceName,
    blockers: unique(blockers),
    plugins
  };
}

function listPlugins(options = {}) {
  const loaded = loadMarketplace(options.marketplaceRoot);
  if (loaded.ok) return listSourcePlugins(loaded.marketplaceRoot, loaded.marketplace);
  if (loaded.blockers.length === 1 && loaded.blockers[0] === 'missing-marketplace-json') {
    return listInstalledCachePlugins(loaded.marketplaceRoot, options.marketplaceName || path.basename(loaded.marketplaceRoot));
  }
  return {
    ok: false,
    discovery: 'codex-marketplace-json',
    marketplace_root: loaded.marketplaceRoot,
    blockers: unique(loaded.blockers),
    plugins: []
  };
}

function resolvePlugin(options = {}) {
  if (!isNonEmpty(options.plugin)) {
    return {
      ok: false,
      marketplace_root: resolveMarketplaceRoot(options.marketplaceRoot),
      blockers: ['missing-argument:--plugin'],
      plugin: null
    };
  }
  const suite = listPlugins(options);
  if (!suite.plugins.length) return { ...suite, plugin: null };
  const plugin = suite.plugins.find((item) => item.name === options.plugin);
  if (!plugin) {
    return {
      ok: false,
      marketplace_root: suite.marketplace_root,
      blockers: [`missing-plugin:${options.plugin}`],
      plugin: null
    };
  }
  return {
    ok: plugin.ok,
    marketplace_root: suite.marketplace_root,
    blockers: unique(plugin.blockers),
    plugin
  };
}

function requirePlugins(options = {}) {
  const required = (options.plugins || []).filter(isNonEmpty);
  if (!required.length) {
    return {
      ok: false,
      marketplace_root: resolveMarketplaceRoot(options.marketplaceRoot),
      blockers: ['missing-argument:--plugin'],
      required,
      plugins: []
    };
  }
  const suiteStatus = listPlugins(options);
  if (!suiteStatus.plugins.length) {
    return {
      ok: false,
      discovery: suiteStatus.discovery,
      marketplace_root: suiteStatus.marketplace_root,
      marketplace_name: suiteStatus.marketplace_name || null,
      blockers: unique(suiteStatus.blockers),
      required,
      plugins: []
    };
  }

  const plugins = [];
  const blockers = [];
  for (const name of required) {
    const plugin = suiteStatus.plugins.find((item) => item.name === name);
    if (!plugin) blockers.push(`missing-plugin:${name}`);
    else {
      plugins.push(plugin);
      blockers.push(...plugin.blockers);
    }
  }
  return {
    ok: blockers.length === 0,
    discovery: suiteStatus.discovery,
    marketplace_root: suiteStatus.marketplace_root,
    marketplace_name: suiteStatus.marketplace_name || null,
    blockers: unique(blockers),
    required,
    plugins
  };
}

function parseArgs(args) {
  let command = 'list';
  let commandSeen = false;
  const plugins = [];
  let marketplaceRoot = null;
  const blockers = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (!arg.startsWith('--')) {
      if (!commandSeen) {
        command = arg;
        commandSeen = true;
      } else {
        blockers.push(`unknown-command:${arg}`);
      }
      continue;
    }
    if (arg !== '--plugin' && arg !== '--marketplace-root') {
      blockers.push(`unknown-argument:${arg}`);
      if (isNonEmpty(args[i + 1]) && !args[i + 1].startsWith('--')) i += 1;
      continue;
    }
    const value = args[i + 1];
    if (!isNonEmpty(value) || value.startsWith('--')) {
      blockers.push(`missing-argument:${arg}`);
      continue;
    }
    if (arg === '--plugin') plugins.push(value);
    else if (marketplaceRoot) blockers.push('duplicate-argument:--marketplace-root');
    else marketplaceRoot = value;
    i += 1;
  }

  if (!COMMANDS.has(command)) blockers.push(`unknown-command:${command}`);
  if (command === 'resolve' && plugins.length !== 1) blockers.push(plugins.length ? 'duplicate-argument:--plugin' : 'missing-argument:--plugin');
  if (command === 'require' && !plugins.length) blockers.push('missing-argument:--plugin');

  return {
    command,
    marketplaceRoot,
    plugin: plugins[plugins.length - 1] || null,
    plugins,
    blockers: unique(blockers)
  };
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  let result;
  if (cli.blockers.length) {
    result = {
      ok: false,
      marketplace_root: resolveMarketplaceRoot(cli.marketplaceRoot),
      blockers: cli.blockers
    };
  } else if (cli.command === 'list') {
    result = listPlugins({ marketplaceRoot: cli.marketplaceRoot });
  } else if (cli.command === 'resolve') {
    result = resolvePlugin({ marketplaceRoot: cli.marketplaceRoot, plugin: cli.plugin });
  } else {
    result = requirePlugins({ marketplaceRoot: cli.marketplaceRoot, plugins: cli.plugins });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  REQUIRED_SPECNAV_PLUGINS,
  findMarketplaceRoot,
  listPlugins,
  resolvePlugin,
  requirePlugins
};
