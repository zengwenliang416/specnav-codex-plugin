#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');
const suite = require('./plugin-suite');

const REQUIRED_PLUGINS = [
  'specnav-core',
  'specnav-requirements',
  'specnav-prototype',
  'specnav-development',
  'specnav-verification',
  'specnav-operations',
  'specnav-codegraph'
];

const ACTION_PLUGINS = {
  bootstrap: ['specnav-core'],
  requirements: ['specnav-core', 'specnav-requirements'],
  design: ['specnav-core', 'specnav-requirements'],
  tasks: ['specnav-core', 'specnav-requirements'],
  implement: ['specnav-core', 'specnav-development'],
  fix: ['specnav-core', 'specnav-development', 'specnav-verification'],
  verify: ['specnav-core', 'specnav-verification'],
  release: ['specnav-core', 'specnav-verification', 'specnav-operations'],
  archive: ['specnav-core', 'specnav-verification', 'specnav-operations'],
  status: ['specnav-core']
};

function defaultMarketplaceRoot() {
  return path.resolve(__dirname, '../../..');
}

function buildAffordances(root, options = {}) {
  const open = lib.openspecDir(root);
  const changeState = lib.activeChangeState(root);
  const change = changeState.change;
  const dir = lib.changeDir(root, change);
  const legacyEntrypoints = lib.detectLegacyOpenSpecEntrypoints(root);
  const legacyBlocker = legacyEntrypoints.length ? 'legacy-openspec-workflow' : null;
  const suiteStatus = options.suiteStatus || suite.listPlugins({
    marketplaceRoot: options.marketplaceRoot || process.env.SPECNAV_MARKETPLACE_ROOT || defaultMarketplaceRoot()
  });
  const okPlugins = new Set((suiteStatus.plugins || []).filter((plugin) => plugin.ok).map((plugin) => plugin.name));
  const hasOpenSpec = fs.existsSync(open);
  const openspecStatus = hasOpenSpec && change ? lib.openspecStatus(root, change) : { ok: false, error: 'openspec-missing-or-no-change' };
  const openspecStateBlocker = hasOpenSpec && change && !openspecStatus.ok
    ? `openspec-status:${openspecStatus.error || 'unavailable'}`
    : null;
  const openspecArtifacts = new Map(
    openspecStatus.ok
      ? (openspecStatus.status.artifacts || []).map((artifact) => [artifact.id, artifact.status])
      : []
  );
  const artifactDone = (id) => openspecArtifacts.get(id) === 'done';
  const useOpenSpec = hasOpenSpec && change && openspecStatus.ok;
  const proposal = useOpenSpec ? artifactDone('proposal') : false;
  const design = useOpenSpec ? artifactDone('design') : false;
  const tasks = useOpenSpec ? artifactDone('tasks') : false;
  const specs = useOpenSpec ? artifactDone('specs') : false;
  const scope = dir && lib.fileExists(path.join(dir, 'scope.json'));
  const risk = lib.readJson(dir && path.join(dir, 'risk-tier.json'), { tier: 'standard', source: 'default' });
  const verify = lib.readJson(dir && path.join(dir, 'verify-report.json'), null);
  const staleMarker = dir && lib.fileExists(path.join(dir, 'verify-report.stale'));
  const verifyStatus = verify ? verify.status : 'not_run';
  const verifyReportStale = !!(verify && staleMarker);
  const signoff = dir && lib.fileExists(path.join(dir, 'signoff.yaml'));
  const operations = lib.readJson(dir && path.join(dir, 'operations', 'readiness.json'), null);
  const operationsReady = !!(operations && operations.ready === true);
  const globalBlockers = [
    ...((suiteStatus && suiteStatus.blockers) || []),
    !hasOpenSpec ? 'missing-openspec' : null,
    hasOpenSpec ? legacyBlocker : null,
    hasOpenSpec && !change ? changeState.blockers[0] : null,
    openspecStateBlocker
  ].filter(Boolean);
  const lifecycleBlockers = [
    legacyBlocker,
    hasOpenSpec && !change ? changeState.blockers[0] : null,
    openspecStateBlocker
  ].filter(Boolean);

  const actions = [];
  const add = (id, ready, blockers = [], reversible = true) => {
    const requiredPlugins = ACTION_PLUGINS[id] || ['specnav-core'];
    const pluginBlockers = requiredPlugins
      .filter((plugin) => !okPlugins.has(plugin))
      .map((plugin) => `missing-plugin:${plugin}`);
    const allBlockers = [...blockers, ...pluginBlockers];
    actions.push({
      id,
      state: ready && allBlockers.length === 0 ? 'ready' : 'blocked',
      reversible,
      required_plugins: requiredPlugins,
      blocked_by: allBlockers
    });
  };

  add('bootstrap', !hasOpenSpec, hasOpenSpec ? ['openspec-exists'] : []);
  add('requirements', hasOpenSpec && lifecycleBlockers.length === 0, hasOpenSpec ? lifecycleBlockers : ['bootstrap']);
  add('design', !!(proposal && !design && lifecycleBlockers.length === 0), lifecycleBlockers.length ? lifecycleBlockers : (proposal ? [] : ['proposal']));
  add('tasks', !!(design && !tasks && lifecycleBlockers.length === 0), lifecycleBlockers.length ? lifecycleBlockers : (design ? [] : ['design']));
  add('implement', !!(tasks && (verifyStatus !== 'green' || verifyReportStale) && lifecycleBlockers.length === 0), lifecycleBlockers.length ? lifecycleBlockers : (tasks ? [] : ['tasks']));
  add('fix', !!(tasks && verify && (verifyStatus !== 'green' || verifyReportStale) && lifecycleBlockers.length === 0), lifecycleBlockers.length ? lifecycleBlockers : (verify ? [] : ['verify']));
  add('verify', !!(tasks && lifecycleBlockers.length === 0), lifecycleBlockers.length ? lifecycleBlockers : (tasks ? [] : ['tasks']));
  const releaseBlockers = [];
  releaseBlockers.push(...lifecycleBlockers);
  if (!verify || verify.status !== 'green') releaseBlockers.push('verify');
  if (verifyReportStale) releaseBlockers.push('fresh-verify');
  if (risk.tier === 'high-risk' && !signoff) releaseBlockers.push('human-signoff');
  add('release', releaseBlockers.length === 0, releaseBlockers, false);
  const archiveBlockers = [...releaseBlockers];
  if (!operationsReady) archiveBlockers.push('operations');
  add('archive', archiveBlockers.length === 0, archiveBlockers, false);
  add('status', true);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_root: root,
    required_plugins: REQUIRED_PLUGINS,
    plugin_suite: {
      ok: suiteStatus.ok,
      marketplace_root: suiteStatus.marketplace_root,
      blockers: suiteStatus.blockers || []
    },
    state_source: useOpenSpec ? 'openspec-cli' : (openspecStateBlocker ? 'blocked' : (hasOpenSpec ? changeState.source : 'missing-openspec')),
    blockers: globalBlockers,
    change_resolution: {
      source: changeState.source,
      candidates: changeState.candidates || [],
      blockers: changeState.blockers || []
    },
    change_registry: changeState.registry,
    legacy_openspec_entrypoints: legacyEntrypoints,
    openspec_status: openspecStatus.ok
      ? {
          schema_name: openspecStatus.status.schemaName,
          is_complete: openspecStatus.status.isComplete,
          apply_requires: openspecStatus.status.applyRequires || []
        }
      : {
          ok: false,
          error: openspecStatus.error || 'unavailable'
        },
    active_change: change,
    risk_tier: risk.tier || 'standard',
    risk_source: risk.source || 'default',
    verify_status: verifyStatus,
    verify_report_stale: verifyReportStale,
    artifacts: {
      openspec: hasOpenSpec,
      proposal: !!proposal,
      design: !!design,
      scope: !!scope,
      tasks: !!tasks,
      specs: !!specs,
      signoff: !!signoff,
      operations_readiness: operationsReady
    },
    actions
  };
}

function toMarkdown(table) {
  const lines = [];
  lines.push('# SpecNav Status');
  lines.push('');
  lines.push(`- project: \`${table.project_root}\``);
  lines.push(`- state source: \`${table.state_source}\``);
  lines.push(`- active change: \`${table.active_change || 'none'}\``);
  lines.push(`- risk tier: \`${table.risk_tier}\` (${table.risk_source})`);
  lines.push(`- verify: \`${table.verify_status}\`${table.verify_report_stale ? ' (stale)' : ''}`);
  lines.push(`- required plugins: \`${table.required_plugins.join(', ')}\``);
  lines.push('');
  lines.push('| Action | State | Required Plugins | Blockers |');
  lines.push('| --- | --- | --- | --- |');
  for (const action of table.actions) {
    lines.push(`| ${action.id} | ${action.state} | ${(action.required_plugins || []).join(', ') || '-'} | ${action.blocked_by.join(', ') || '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const root = lib.projectRoot();
  const table = buildAffordances(root);
  if (process.argv.includes('--write-snapshot')) {
    lib.writeJson(path.join(lib.specnavDir(root), 'affordances.json'), table);
    lib.event(root, 'affordances.write', { active_change: table.active_change });
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(table, null, 2)}\n`);
  } else {
    process.stdout.write(toMarkdown(table));
  }
}

if (require.main === module) main();

module.exports = { buildAffordances, toMarkdown };
