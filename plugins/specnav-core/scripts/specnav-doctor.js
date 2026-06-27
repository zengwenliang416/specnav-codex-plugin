#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');
const suite = require('./plugin-suite');
const workflow = require('./workflow-state');

const REQUIRED_PLUGINS = suite.REQUIRED_SPECNAV_PLUGINS;

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function defaultPluginRoot() {
  return path.resolve(__dirname, '..');
}

function defaultMarketplaceRoot(pluginRoot = defaultPluginRoot()) {
  return path.resolve(pluginRoot, '../..');
}

function check(name, ok, detail = '') {
  return { name, status: ok ? 'pass' : 'fail', ok, detail };
}

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function codexPluginInventory(marketplaceRoot) {
  if (process.env.SPECNAV_PLUGIN_LIST_JSON && process.env.SPECNAV_PLUGIN_LIST_JSON.trim()) {
    try {
      const plugins = JSON.parse(process.env.SPECNAV_PLUGIN_LIST_JSON);
      if (!Array.isArray(plugins)) {
        return { ok: false, plugins: [], error: 'SPECNAV_PLUGIN_LIST_JSON must be an array' };
      }
      return { ok: true, plugins, error: null };
    } catch (_error) {
      return { ok: false, plugins: [], error: 'SPECNAV_PLUGIN_LIST_JSON is invalid JSON' };
    }
  }
  const result = lib.runCommand('codex plugin list --json', {
    cwd: marketplaceRoot,
    timeoutMs: 30000
  });
  if (!result.ok) {
    return {
      ok: false,
      plugins: [],
      error: result.stderr || result.stdout || `codex plugin list exited ${result.status}`
    };
  }
  try {
    const payload = JSON.parse(result.stdout);
    const plugins = Array.isArray(payload) ? payload : payload && payload.installed;
    if (!Array.isArray(plugins)) {
      return { ok: false, plugins: [], error: 'codex plugin list returned non-array JSON' };
    }
    return { ok: true, plugins, error: null };
  } catch (_error) {
    return { ok: false, plugins: [], error: 'codex plugin list returned invalid JSON' };
  }
}

function doctor(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot || defaultPluginRoot());
  const marketplaceRoot = path.resolve(options.marketplaceRoot || defaultMarketplaceRoot(pluginRoot));
  const targetRoot = process.env.PROJECT_DIR ? path.resolve(process.env.PROJECT_DIR) : null;
  const suiteStatus = suite.listPlugins({ marketplaceRoot });
  const marketplace = readJsonFile(path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'), {});
  const marketplaceName = suiteStatus.marketplace_name || (marketplace && marketplace.name) || 'specnav-marketplace';
  const codexInventory = codexPluginInventory(marketplaceRoot);
  const hasMarketplaceManifest = fs.existsSync(path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'));
  const checks = [];

  checks.push(check('plugin-root', fs.existsSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json')), pluginRoot));
  checks.push(check(
    'marketplace-root',
    hasMarketplaceManifest || suiteStatus.discovery === 'codex-installed-cache',
    hasMarketplaceManifest ? marketplaceRoot : `${marketplaceRoot} (${suiteStatus.discovery || 'unknown'})`
  ));
  checks.push(check('plugin-suite', suiteStatus.ok, suiteStatus.blockers.join(', ') || 'ok'));
  checks.push(check('hooks', fs.existsSync(path.join(pluginRoot, 'hooks', 'hooks.json')), 'plugins/specnav-core/hooks/hooks.json'));
  checks.push(check('core-runtime', fs.existsSync(path.join(pluginRoot, 'scripts', 'plugin-suite.js')) && fs.existsSync(path.join(pluginRoot, 'scripts', 'workflow-state.js')), 'core scripts'));
  checks.push(check('skills', fs.existsSync(path.join(pluginRoot, 'skills', 'specnav-bootstrap', 'SKILL.md')), 'specnav skills'));
  checks.push(check('codex-plugin-list', codexInventory.ok, codexInventory.ok ? 'ok' : codexInventory.error));
  if (codexInventory.ok) {
    for (const pluginName of REQUIRED_PLUGINS) {
      const pluginId = `${pluginName}@${marketplaceName}`;
      const plugin = codexInventory.plugins.find((item) => item && (item.id === pluginId || item.pluginId === pluginId));
      checks.push(check(
        `installed:${pluginName}`,
        !!plugin,
        plugin ? plugin.installPath || plugin.version || 'installed' : pluginId
      ));
      checks.push(check(
        `enabled:${pluginName}`,
        !!plugin && plugin.enabled === true,
        plugin ? `enabled=${plugin.enabled}` : pluginId
      ));
    }
  }
  const openspecCli = lib.runCommand('command -v openspec', { cwd: marketplaceRoot, timeoutMs: 10000 });
  checks.push(check('openspec-cli', openspecCli.ok, openspecCli.ok ? openspecCli.stdout.trim() : (openspecCli.stderr || 'openspec not found')));
  if (targetRoot) {
    const specnavDir = lib.specnavDir(targetRoot);
    const hasOpenSpec = fs.existsSync(lib.openspecDir(targetRoot));
    checks.push(check('target-openspec', hasOpenSpec, targetRoot));
    if (hasOpenSpec) {
      checks.push(check('workflow-state-file', fs.existsSync(path.join(specnavDir, 'workflow-state.json')), 'openspec/.specnav/workflow-state.json'));
      const contextOk = workflow.CONTEXT_MANIFESTS.every(([, fileName]) => {
        const file = path.join(specnavDir, 'context', fileName);
        return fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() !== '';
      });
      checks.push(check('context-manifests', contextOk, 'openspec/.specnav/context/*.jsonl'));
      checks.push(check('journal', fs.existsSync(path.join(specnavDir, 'journal', 'index.md')), 'openspec/.specnav/journal/index.md'));
    }
  }

  const blockers = checks.filter((item) => !item.ok).map((item) => item.name);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'ready' : 'blocked',
    plugin_root: pluginRoot,
    marketplace_root: marketplaceRoot,
    target_root: targetRoot,
    blockers,
    checks,
    suite: suiteStatus,
    codex_plugins: {
      ok: codexInventory.ok,
      marketplace: marketplaceName,
      required: REQUIRED_PLUGINS.map((name) => `${name}@${marketplaceName}`)
    }
  };
}

function toText(result) {
  const lines = [];
  lines.push('# SpecNav Doctor');
  lines.push('');
  lines.push(`- status: ${result.status}`);
  lines.push(`- plugin_root: ${result.plugin_root}`);
  lines.push(`- marketplace_root: ${result.marketplace_root}`);
  lines.push(`- blockers: ${result.blockers.join(', ') || '-'}`);
  lines.push('');
  lines.push('| Check | Status | Detail |');
  lines.push('| --- | --- | --- |');
  for (const item of result.checks) {
    lines.push(`| ${item.name} | ${item.status} | ${item.detail || '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const result = doctor({
    marketplaceRoot: argValue(args, '--marketplace-root', null),
    pluginRoot: argValue(args, '--plugin-root', null)
  });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(toText(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { doctor, toText };
