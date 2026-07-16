#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const lib = require('./specnav-lib');
const affordances = require('./affordances');
const suite = require('./plugin-suite');

// Stage manifests collapsed into one overwrite-in-place snapshot
// (context/current.json). The old per-stage append-only *.jsonl files grew
// unbounded (5 appends per --write) and carried the same five identical rows.
const CONTEXT_SNAPSHOT = 'current.json';
const MAX_JOURNAL_SESSIONS = 10;

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

function journalSessionName(date = new Date()) {
  return `session-${date.toISOString().replace(/[:.]/g, '-')}.md`;
}

function pruneJournal(journalDir) {
  let sessions = [];
  try {
    sessions = fs.readdirSync(journalDir)
      .filter((name) => /^session-.*\.md$/.test(name))
      .sort();
  } catch {
    return;
  }
  for (const name of sessions.slice(0, Math.max(0, sessions.length - MAX_JOURNAL_SESSIONS))) {
    try {
      fs.unlinkSync(path.join(journalDir, name));
    } catch {}
  }
}

const RUNTIME_GITIGNORE = [
  '# SpecNav session-local runtime state — never version this.',
  'events.jsonl',
  'workflow-state.json',
  'session-lock',
  'warned.json',
  'journal/',
  'context/',
  ''
].join('\n');

function ensureRuntimeGitignore(specnavDir) {
  const file = path.join(specnavDir, '.gitignore');
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, RUNTIME_GITIGNORE);
  } catch {}
}

function writeRuntimeArtifacts(root, result = workflowState(root)) {
  lib.ensureSpecNavMarker(root);
  const specnavDir = lib.specnavDir(root);
  lib.ensureDir(specnavDir);
  ensureRuntimeGitignore(specnavDir);
  lib.writeJson(path.join(specnavDir, 'workflow-state.json'), result);
  const registry = result.change_registry || lib.buildChangeRegistry(root);
  registry.current_focus = result.active_change || registry.current_focus || null;
  lib.writeChangeRegistry(root, registry);

  lib.writeJson(path.join(specnavDir, 'context', CONTEXT_SNAPSHOT), {
    schema: 'specnav.contextManifest.v2',
    generated_at: result.generated_at,
    project_root: result.project_root,
    active_change: result.active_change,
    status: result.status,
    blockers: result.blockers,
    ready_actions: result.actions
      .filter((action) => action.state === 'ready')
      .map((action) => action.id)
  });

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
  pruneJournal(journalDir);

  lib.event(root, 'workflow-state.write', {
    active_change: result.active_change,
    status: result.status,
    context_manifest: `openspec/.specnav/context/${CONTEXT_SNAPSHOT}`,
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

// Context is a budget: default stdout is a one-line decision summary. The
// full affordance table is on disk (workflow-state.json) and behind --verbose.
function toCompact(result) {
  return {
    ok: result.ok,
    status: result.status,
    active_change: result.active_change,
    blockers: result.blockers,
    ready_actions: result.actions
      .filter((action) => action.state === 'ready')
      .map((action) => action.id),
    detail: 'openspec/.specnav/workflow-state.json'
  };
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
  const verbose = args.includes('--verbose');
  if (args.includes('--json')) {
    process.stdout.write(verbose ? `${JSON.stringify(result, null, 2)}\n` : `${JSON.stringify(toCompact(result))}\n`);
  } else if (verbose) {
    process.stdout.write(toText(result));
  } else {
    const compact = toCompact(result);
    process.stdout.write(`SpecNav: ${compact.status} change=${compact.active_change || 'none'} ready=[${compact.ready_actions.join(', ')}] blockers=[${compact.blockers.join(', ')}] (--verbose for the full table)\n`);
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { CONTEXT_SNAPSHOT, MAX_JOURNAL_SESSIONS, workflowState, writeRuntimeArtifacts, toText };
