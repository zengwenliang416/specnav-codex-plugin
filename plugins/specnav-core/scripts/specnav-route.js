#!/usr/bin/env node
'use strict';

const path = require('path');
const suite = require('./plugin-suite');
const lib = require('./specnav-lib');
const { buildAffordances } = require('./affordances');
const { triageChange, splitPaths } = require('./change-triage');

const ROUTES = {
  bootstrap: {
    target_plugin: 'specnav-core',
    command: '$specnav-bootstrap',
    skill: 'specnav-bootstrap',
    required_plugins: ['specnav-core'],
    action: 'bootstrap'
  },
  foundation: {
    target_plugin: 'specnav-requirements',
    command: '$specnav-foundation-specs',
    skill: 'specnav-foundation-specs',
    skills: ['specnav-repository-discovery', 'specnav-foundation-specs'],
    required_plugins: ['specnav-core', 'specnav-requirements'],
    action: 'requirements'
  },
  requirements: {
    target_plugin: 'specnav-requirements',
    command: '$specnav-requirements',
    skill: 'specnav-requirements',
    required_plugins: ['specnav-core', 'specnav-requirements'],
    action: 'requirements'
  },
  prototype: {
    target_plugin: 'specnav-prototype',
    command: '$specnav-prototype',
    skill: 'specnav-prototype',
    required_plugins: ['specnav-core', 'specnav-requirements', 'specnav-prototype'],
    action: null
  },
  development: {
    target_plugin: 'specnav-development',
    command: '$specnav-development-entry',
    skill: 'specnav-development-entry',
    required_plugins: ['specnav-core', 'specnav-development'],
    action: 'implement'
  },
  light: {
    target_plugin: 'specnav-development',
    command: '$specnav-light-change',
    skill: 'specnav-light-change',
    required_plugins: ['specnav-core', 'specnav-requirements', 'specnav-prototype', 'specnav-development'],
    action: null
  },
  fix: {
    target_plugin: 'specnav-development',
    command: '$specnav-fix',
    skill: 'specnav-fix',
    required_plugins: ['specnav-core', 'specnav-development', 'specnav-verification'],
    action: 'fix'
  },
  verification: {
    target_plugin: 'specnav-verification',
    command: '$specnav-verification',
    skill: 'specnav-verification',
    required_plugins: ['specnav-core', 'specnav-verification'],
    action: 'verify'
  },
  release: {
    target_plugin: 'specnav-operations',
    command: '$specnav-release-plan',
    skill: 'specnav-release-plan',
    required_plugins: ['specnav-core', 'specnav-verification', 'specnav-operations'],
    action: 'release',
    confirmation_required: true
  },
  archive: {
    target_plugin: 'specnav-operations',
    command: '$specnav-branch-finish',
    skill: 'specnav-branch-finish',
    required_plugins: ['specnav-core', 'specnav-verification', 'specnav-operations'],
    action: 'archive',
    confirmation_required: true
  },
  status: {
    target_plugin: 'specnav-core',
    command: '$specnav-status',
    skill: 'specnav-status',
    required_plugins: ['specnav-core'],
    action: 'status'
  }
};

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

function defaultMarketplaceRoot() {
  return path.resolve(__dirname, '../../..');
}

function parseArgs(args) {
  const blockers = [];
  let intent = '';
  let paths = [];
  let marketplaceRoot = process.env.SPECNAV_MARKETPLACE_ROOT || defaultMarketplaceRoot();
  let json = false;
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--intent' || arg === '--marketplace-root' || arg === '--paths') {
      const value = args[i + 1];
      if (!isNonEmpty(value) || value.startsWith('--')) {
        blockers.push(`missing-argument:${arg}`);
        continue;
      }
      if (arg === '--intent') intent = value;
      else if (arg === '--paths') paths.push(...splitPaths(value));
      else marketplaceRoot = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      blockers.push(`unknown-argument:${arg}`);
      if (isNonEmpty(args[i + 1]) && !args[i + 1].startsWith('--')) i += 1;
      continue;
    }
    positional.push(arg);
  }

  if (!intent && positional.length) intent = positional.join(' ');
  return {
    intent,
    paths: unique(paths),
    marketplaceRoot: path.resolve(marketplaceRoot),
    json,
    blockers: unique(blockers)
  };
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function classifyIntent(intent, affordances, triage = null) {
  const text = String(intent || '').toLowerCase();
  const missingOpenSpec = (affordances.blockers || []).includes('missing-openspec')
    || !!((affordances.actions || []).find((action) => action.id === 'bootstrap' && action.state === 'ready'));
  if (missingOpenSpec) return 'bootstrap';

  if (includesAny(text, [
    /\bfoundation\b/,
    /\bfoundation specs?\b/,
    /\bproject standards?\b/,
    /\bproject-standard\b/,
    /\bcomplete project specs?\b/,
    /\bcomplete specs?\b/,
    /\brepository discovery\b/,
    /\bui design\b/,
    /\bsystem architecture\b/,
    /\bfrontend[- ]backend\b/,
    /\bdata flow\b/,
    /\bcomponent architecture\b/,
    /\barchitecture constraints?\b/,
    /\bdevelopment conventions?\b/,
    /\bspecs?\b/
  ])) return 'foundation';

  if (includesAny(text, [/\barchive\b/])) return 'archive';
  if (includesAny(text, [/\brelease\b/, /\bdeploy\b/, /\brollback\b/, /\bmonitor\b/, /\bpostmortem\b/, /\boperations?\b/, /\bops\b/])) return 'release';
  if (includesAny(text, [/\bverify\b/, /\bverification\b/, /\bcheck\b/, /\bvalidate\b/, /\btest\b/, /\bfacticity\b/, /\be2e\b/, /\bred ?team\b/, /\bsensory\b/])) return 'verification';
  if (triage && triage.lane === 'light') return 'light';
  if (includesAny(text, [/\bfix\b/, /\bdebug\b/, /\brepair\b/, /\bbreak loop\b/])) return 'fix';
  if (includesAny(text, [/\bimplement\b/, /\bbuild\b/, /\bdevelop\b/, /\bcode\b/, /\bvertical slice\b/])) return 'development';
  if (includesAny(text, [/\bprototype\b/, /\bmock\b/, /\bwireframe\b/, /\bclickable\b/])) return 'prototype';
  if (includesAny(text, [/\brequirements?\b/, /\bacceptance\b/, /\bproposal\b/, /\bpropose\b/, /\bdefine\b/, /\bdiscover\b/, /\bquestion\b/])) return 'requirements';
  if (includesAny(text, [/\bstatus\b/, /\bdoctor\b/, /\bwhere\b/, /\bnext\b/])) return 'status';

  const ready = (affordances.actions || []).find((action) => action.state === 'ready' && action.id !== 'status');
  if (ready && ROUTES[ready.id]) return ready.id;
  return 'status';
}

function findAction(affordances, id) {
  return (affordances.actions || []).find((action) => action.id === id) || null;
}

function pluginRoot(suiteStatus, pluginName) {
  return ((suiteStatus.plugins || []).find((plugin) => plugin.name === pluginName) || {}).root || null;
}

function targetSuiteBlockers(route, marketplaceRoot) {
  const required = suite.requirePlugins({ marketplaceRoot, plugins: route.required_plugins });
  return {
    result: required,
    blockers: required.ok ? [] : (required.blockers || [])
  };
}

function validateFoundation(projectRoot, suiteStatus) {
  const requirementsRoot = pluginRoot(suiteStatus, 'specnav-requirements');
  const coreRoot = pluginRoot(suiteStatus, 'specnav-core');
  if (!requirementsRoot) return { ok: false, blockers: ['missing-plugin:specnav-requirements'], specs: [] };
  if (coreRoot) process.env.SPECNAV_CORE_ROOT = coreRoot;
  process.env.SPECNAV_REQUIREMENTS_ROOT = requirementsRoot;
  const foundation = require(path.join(requirementsRoot, 'scripts', 'foundation-specs.js'));
  return foundation.validateFoundationSpecs(projectRoot);
}

function buildRoute(cli) {
  const suiteStatus = suite.listPlugins({ marketplaceRoot: cli.marketplaceRoot });
  const root = lib.projectRoot();
  const affordances = buildAffordances(root, { marketplaceRoot: cli.marketplaceRoot, suiteStatus });
  const triage = triageChange({ intent: cli.intent, paths: cli.paths || [] });
  const routeId = classifyIntent(cli.intent, affordances, triage);
  const route = ROUTES[routeId] || ROUTES.status;
  const targetCheck = targetSuiteBlockers(route, cli.marketplaceRoot);
  const action = route.action ? findAction(affordances, route.action) : null;
  const actionBlockers = action && action.state === 'blocked' ? (action.blocked_by || []) : [];
  let foundation = null;
  let foundationBlockers = [];

  if (routeId === 'foundation' && !((affordances.blockers || []).includes('missing-openspec'))) {
    foundation = validateFoundation(root, suiteStatus);
    foundationBlockers = foundation.ok ? [] : (foundation.blockers || []);
  }

  const blockers = unique([
    ...cli.blockers,
    ...targetCheck.blockers,
    ...actionBlockers,
    ...foundationBlockers
  ]);

  return {
    ok: blockers.length === 0,
    intent: cli.intent,
    route: routeId,
    target_plugin: route.target_plugin,
    command: route.command,
    skill: route.skill,
    ...(route.skills ? { skills: route.skills } : {}),
    required_plugins: route.required_plugins,
    blockers,
    confirmation_required: route.confirmation_required === true,
    no_fallback: true,
    marketplace_root: cli.marketplaceRoot,
    project_root: root,
    triage,
    action: action ? {
      id: action.id,
      state: action.state,
      blocked_by: action.blocked_by || []
    } : null,
    plugin_suite: {
      ok: suiteStatus.ok,
      discovery: suiteStatus.discovery,
      blockers: suiteStatus.blockers || []
    },
    affordance_state: affordances.state_source,
    ...(foundation ? { foundation } : {})
  };
}

function toMarkdown(result) {
  return [
    '# SpecNav Route',
    '',
    `- target plugin: \`${result.target_plugin}\``,
    `- command: \`${result.command}\``,
    `- skill: \`${result.skill}\``,
    `- required plugins: \`${result.required_plugins.join(', ')}\``,
    `- blockers: \`${result.blockers.join(', ') || 'none'}\``,
    `- lane: \`${result.triage ? result.triage.lane : 'unknown'}\``,
    `- confirmation required: \`${result.confirmation_required}\``,
    `- no fallback: \`${result.no_fallback}\``
  ].join('\n') + '\n';
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const result = buildRoute(cli);
  process.stdout.write(cli.json ? `${JSON.stringify(result, null, 2)}\n` : toMarkdown(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  buildRoute,
  classifyIntent,
  parseArgs
};
