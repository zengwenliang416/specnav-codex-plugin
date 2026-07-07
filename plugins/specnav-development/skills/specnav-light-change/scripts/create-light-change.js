#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function coreRoot() {
  return process.env.SPECNAV_CORE_ROOT || path.resolve(__dirname, '../../../../specnav-core');
}

const lib = require(path.join(coreRoot(), 'scripts/specnav-lib'));
const scaffold = require(path.join(coreRoot(), 'scripts/scaffold-lib'));
const { triageChange, splitPaths } = require(path.join(coreRoot(), 'scripts/change-triage'));

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    project: null,
    change: null,
    intent: '',
    paths: [],
    force: false,
    dryRun: false,
    json: false,
    help: false,
    blockers: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (['--project', '--change', '--intent', '--paths'].includes(arg)) {
      const value = argv[index + 1];
      if (!isNonEmpty(value) || value.startsWith('--')) {
        options.blockers.push(`missing-option-value:${arg}`);
        continue;
      }
      if (arg === '--project') options.project = value;
      else if (arg === '--change') options.change = value;
      else if (arg === '--intent') options.intent = value;
      else options.paths.push(...splitPaths(value));
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      options.blockers.push(`unknown-option:${arg}`);
      if (isNonEmpty(argv[index + 1]) && !argv[index + 1].startsWith('--')) index += 1;
    }
  }

  options.paths = Array.from(new Set(options.paths));
  return options;
}

function usage() {
  return [
    'Usage: create-light-change.js --intent <text> --paths <path[,path...]> [--project <dir>] [--change <id>] [--force] [--dry-run] [--json]',
    '',
    'Creates the minimum SpecNav light-lane artifacts for an existing active OpenSpec change.',
    '',
    'Required:',
    '  --intent <text>       User request or summary.',
    '  --paths <paths>       Intended editable files or roots. Comma-separated values are accepted.',
    '',
    'Options:',
    '  --project <dir>      Project root. Defaults to PROJECT_DIR, PWD, or current directory.',
    '  --change <id>        Explicit active change id.',
    '  --force              Overwrite existing light artifacts.',
    '  --dry-run            Report planned writes without writing.',
    '  --json               Print machine-readable output.',
    '  --help               Show this help.'
  ].join('\n');
}

function projectRoot(options) {
  return path.resolve(options.project || process.env.PROJECT_DIR || process.env.PWD || process.cwd());
}

function safePath(value) {
  const clean = String(value || '').trim().split(path.sep).join('/');
  if (!clean || clean.startsWith('/') || clean.includes('\\') || clean.split('/').some((segment) => segment === '..' || segment === '.')) {
    return null;
  }
  return clean;
}

function writeText(file, content, options, files) {
  const exists = fs.existsSync(file);
  const relative = path.relative(options.root, file).split(path.sep).join('/');
  if (exists && !options.force) {
    files.push({ status: 'skipped', path: relative, reason: 'exists' });
    return;
  }
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  files.push({ status: exists ? 'overwritten' : 'created', path: relative });
}

function writeJson(file, value, options, files) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`, options, files);
}

function firstPath(paths) {
  return paths[0] || '<path>';
}

function buildArtifacts(root, change, changeDir, options, triage) {
  const files = [];
  const paths = options.paths.map(safePath).filter(Boolean);
  const now = new Date().toISOString();
  const subject = firstPath(paths);
  const taskText = `User can see the requested light change reflected in ${subject}.`;
  const prototypeDecision = path.join(changeDir, 'prototype', 'decision.json');
  const lightOptions = { ...options, root };

  writeJson(path.join(changeDir, 'risk-tier.json'), {
    schema_version: 1,
    tier: 'lite',
    lane: 'light',
    source: 'change-triage',
    reason: triage.reason,
    confidence: triage.confidence,
    checked_paths: paths,
    escalation_threshold: 10,
    escalation_triggers: triage.escalation_triggers,
    generated_at: now
  }, lightOptions, files);

  writeText(path.join(changeDir, 'requirements.md'), [
    '# Light Requirements',
    '',
    `- Intent: ${options.intent || 'Light change'}`,
    `- Editable paths: ${paths.join(', ')}`,
    '- Lane: light',
    '- Escalate if the edit expands beyond the listed paths or introduces behavior, API, data, auth, security, deployment, or package changes.',
    ''
  ].join('\n'), lightOptions, files);

  writeText(path.join(changeDir, 'acceptance.md'), [
    '# Acceptance',
    '',
    `- [ ] ${taskText}`,
    ''
  ].join('\n'), lightOptions, files);

  writeJson(path.join(changeDir, 'acceptance.json'), {
    schema_version: 1,
    assertions: [
      {
        id: 'LIGHT-001',
        statement: taskText,
        verify_via: 'static',
        status: 'failing',
        evidence_ref: ''
      }
    ]
  }, lightOptions, files);

  writeJson(path.join(changeDir, 'spec-map.json'), {
    schema_version: 1,
    touched_specs: [],
    ui_rules: [],
    architecture_modules: [],
    api_contracts: [],
    database_entities: [],
    permissions: [],
    operational_constraints: [],
    data_flows: [],
    theme_modes: [],
    locale_policy: [],
    unresolved_gaps: []
  }, lightOptions, files);

  writeJson(path.join(changeDir, 'component-impact-map.json'), {
    schema_version: 1,
    new_components: [],
    reused_components: [],
    extraction_triggers: [],
    forbidden_dependencies: [],
    hooks: [],
    utilities: [],
    services: [],
    required_component_tests: [],
    unresolved_gaps: []
  }, lightOptions, files);

  writeJson(prototypeDecision, {
    schema_version: 1,
    status: 'not_required',
    reason: 'Light lane change: no runnable prototype is required for docs/copy/config-only work.',
    decided_at: now
  }, lightOptions, files);

  writeJson(path.join(changeDir, 'scope.json'), {
    schema_version: 1,
    change_id: change,
    stage: 'development',
    allowed_roots: paths,
    denied_roots: ['openspec/changes/archive'],
    requires_review_on: [],
    allowed_operations: {
      create: false,
      modify: true,
      delete: false,
      rename: false
    },
    prototype_sources: [`openspec/changes/${change}/prototype/decision.json`],
    expires_when: 'verification_started'
  }, lightOptions, files);

  writeText(path.join(changeDir, 'tasks.md'), [
    '# Tasks',
    '',
    `- [ ] ${taskText}`,
    ''
  ].join('\n'), lightOptions, files);

  return files;
}

function emit(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!result.ok) {
    process.stderr.write(`${result.message || 'blocked'}\n`);
    for (const blocker of result.blockers || []) process.stderr.write(`- ${blocker}\n`);
    return;
  }
  for (const file of result.files || []) process.stdout.write(`${file.status}: ${file.path}${file.reason ? ` (${file.reason})` : ''}\n`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const root = projectRoot(options);
  const openSpec = scaffold.requireOpenSpec(root);
  const blockers = [...options.blockers];
  if (!isNonEmpty(options.intent)) blockers.push('light-change:intent-required');
  if (!options.paths.length) blockers.push('light-change:paths-required');
  const cleanPaths = options.paths.map(safePath).filter(Boolean);
  if (cleanPaths.length !== options.paths.length) blockers.push('light-change:invalid-path');
  if (!openSpec.ok) blockers.push(...openSpec.blockers);

  if (blockers.length) {
    const result = { ok: false, project_root: root, blockers: Array.from(new Set(blockers)), message: 'Invalid light change request.' };
    emit(result, options.json);
    return 2;
  }

  const active = scaffold.strictActiveChange(root, options.change);
  if (!active.ok) {
    emit({
      ok: false,
      project_root: root,
      blockers: active.blockers,
      change_resolution: active.change_resolution,
      message: active.message
    }, options.json);
    return 2;
  }

  const triage = triageChange({ intent: options.intent, paths: cleanPaths });
  if (triage.lane !== 'light') {
    emit({
      ok: false,
      project_root: root,
      active_change: active.change,
      blockers: [`light-change:triage-${triage.lane}`],
      triage,
      message: 'Triage did not select the light lane.'
    }, options.json);
    return 2;
  }

  const files = buildArtifacts(root, active.change, active.dir, { ...options, paths: cleanPaths }, triage);
  emit({
    ok: true,
    project_root: root,
    active_change: active.change,
    dry_run: options.dryRun,
    force: options.force,
    triage,
    files
  }, options.json);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  buildArtifacts,
  main,
  parseArgs
};
