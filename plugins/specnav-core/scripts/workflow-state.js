#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const lib = require('./specnav-lib');
const affordances = require('./affordances');
const suite = require('./plugin-suite');

const CONTEXT_MANIFESTS = [
  ['requirements', 'requirements-context.jsonl'],
  ['prototype', 'prototype-context.jsonl'],
  ['implement', 'implement-context.jsonl'],
  ['verify', 'verify-context.jsonl'],
  ['ops', 'ops-context.jsonl']
];

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function defaultMarketplaceRoot() {
  return path.resolve(__dirname, '../../..');
}

function workflowState(root = lib.projectRoot(), options = {}) {
  const marketplaceRoot = options.marketplaceRoot || process.env.SPECNAV_MARKETPLACE_ROOT || defaultMarketplaceRoot();
  const pluginSuite = suite.listPlugins({ marketplaceRoot });
  const table = affordances.buildAffordances(root, { suiteStatus: pluginSuite });
  const blockers = [];
  if (!pluginSuite.ok) blockers.push(...pluginSuite.blockers);
  if (!fs.existsSync(lib.openspecDir(root))) blockers.push('missing-openspec');
  if (Array.isArray(table.blockers)) blockers.push(...table.blockers);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'ready' : 'blocked',
    project_root: root,
    active_change: table.active_change,
    marketplace_root: pluginSuite.marketplace_root || marketplaceRoot,
    blockers: Array.from(new Set(blockers)),
    plugin_suite: pluginSuite,
    required_plugins: table.required_plugins,
    actions: table.actions,
    affordances: table
  };
}

function appendJsonl(file, entry) {
  lib.ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function journalSessionName(date = new Date()) {
  return `session-${date.toISOString().replace(/[:.]/g, '-')}.md`;
}

function writeRuntimeArtifacts(root, result = workflowState(root)) {
  lib.ensureSpecNavMarker(root);
  const specnavDir = lib.specnavDir(root);
  lib.writeJson(path.join(specnavDir, 'workflow-state.json'), result);

  for (const [stage, fileName] of CONTEXT_MANIFESTS) {
    appendJsonl(path.join(specnavDir, 'context', fileName), {
      schema: 'specnav.contextManifest.v1',
      generated_at: result.generated_at,
      stage,
      project_root: result.project_root,
      active_change: result.active_change,
      status: result.status,
      blockers: result.blockers,
      ready_actions: result.actions
        .filter((action) => action.state === 'ready')
        .map((action) => action.id)
    });
  }

  const journalDir = path.join(specnavDir, 'journal');
  lib.ensureDir(journalDir);
  const sessionName = journalSessionName();
  const sessionPath = path.join(journalDir, sessionName);
  fs.writeFileSync(sessionPath, [
    '# SpecNav Session Journal',
    '',
    `- generated_at: ${result.generated_at}`,
    `- active_change: ${result.active_change || 'none'}`,
    `- status: ${result.status}`,
    `- blockers: ${result.blockers.join(', ') || '-'}`,
    `- ready_actions: ${result.actions.filter((action) => action.state === 'ready').map((action) => action.id).join(', ') || '-'}`,
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(journalDir, 'index.md'), [
    '# SpecNav Journal',
    '',
    `- latest: ${sessionName}`,
    `- active_change: ${result.active_change || 'none'}`,
    `- status: ${result.status}`,
    ''
  ].join('\n'));

  lib.event(root, 'workflow-state.write', {
    active_change: result.active_change,
    status: result.status,
    context_manifests: CONTEXT_MANIFESTS.map(([, fileName]) => `openspec/.specnav/context/${fileName}`),
    journal: `openspec/.specnav/journal/${sessionName}`
  });

  return result;
}

function toText(result) {
  const lines = [];
  lines.push('# SpecNav Workflow State');
  lines.push('');
  lines.push(`- project: ${result.project_root}`);
  lines.push(`- active_change: ${result.active_change || 'none'}`);
  lines.push(`- status: ${result.status}`);
  lines.push(`- marketplace_root: ${result.marketplace_root}`);
  lines.push(`- blockers: ${result.blockers.join(', ') || '-'}`);
  lines.push('');
  lines.push('| Action | State | Required Plugins | Blockers |');
  lines.push('| --- | --- | --- | --- |');
  for (const action of result.actions) {
    lines.push(`| ${action.id} | ${action.state} | ${(action.required_plugins || []).join(', ') || '-'} | ${action.blocked_by.join(', ') || '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const root = lib.projectRoot(process.argv);
  const result = workflowState(root, {
    marketplaceRoot: argValue(args, '--marketplace-root', null)
  });
  if (args.includes('--write')) {
    writeRuntimeArtifacts(root, result);
  }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(toText(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { CONTEXT_MANIFESTS, workflowState, writeRuntimeArtifacts, toText };
