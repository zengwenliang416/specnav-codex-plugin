#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');

const COMMANDS = new Set(['validate', 'normalize']);
const STATUS = new Set(['todo', 'done']);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    command: 'validate',
    project: null,
    change: null,
    defaultStatus: 'todo',
    dryRun: false,
    json: false,
    help: false,
    errors: []
  };

  function readValue(flag, index) {
    const value = argv[index + 1] || '';
    if (!value || value.startsWith('--')) {
      options.errors.push(`missing-option-value:${flag}`);
      return { value: null, nextIndex: index };
    }
    return { value, nextIndex: index + 1 };
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (COMMANDS.has(arg)) {
      options.command = arg;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--project') {
      const parsed = readValue('--project', index);
      options.project = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--change') {
      const parsed = readValue('--change', index);
      options.change = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--default-status') {
      const parsed = readValue('--default-status', index);
      options.defaultStatus = parsed.value || options.defaultStatus;
      index = parsed.nextIndex;
      continue;
    }
    if (arg.startsWith('--default-status=')) {
      options.defaultStatus = arg.slice('--default-status='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      options.errors.push(`unknown-option:${arg}`);
      continue;
    }
    if (!options.project) options.project = arg;
    else options.errors.push(`unexpected-argument:${arg}`);
  }

  if (!STATUS.has(options.defaultStatus)) {
    options.errors.push(`invalid-default-status:${options.defaultStatus}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node tasks-md.js [validate|normalize] [--project <dir>] [--change <id>] [--default-status todo|done] [--dry-run] [--json]',
    '',
    'Validates or normalizes OpenSpec tasks.md to standard checkbox task syntax.',
    'Plain task bullets normalize to "- [ ]" by default; use --default-status=done only when completion evidence has already been reviewed.'
  ].join('\n');
}

function activeChange(root, explicitChange) {
  const state = explicitChange ? lib.activeChangeState(root, { change: explicitChange }) : lib.activeChangeState(root);
  const change = state.change;
  if (!change) return { ok: false, change: null, blockers: state.blockers || ['active-change'], state };
  const dir = lib.changeDir(root, change);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, change, blockers: [`missing-change-dir:${change}`], state };
  }
  return { ok: true, change, dir, blockers: [], state };
}

function taskLine(line, defaultStatus) {
  const match = String(line).match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/);
  if (!match) return { task: false, line };
  const indent = match[1] || '';
  const marker = match[2] || null;
  const body = (match[3] || '').trim();
  if (!body) return { task: false, line };
  const checked = marker ? (marker.toLowerCase() === 'x' ? 'x' : ' ') : (defaultStatus === 'done' ? 'x' : ' ');
  return {
    task: true,
    hadCheckbox: marker !== null,
    checked: checked === 'x',
    line: `${indent}- [${checked}] ${body}`
  };
}

function normalizeText(text, options = {}) {
  const defaultStatus = options.defaultStatus || 'todo';
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let taskCount = 0;
  let checkboxCount = 0;
  let completedCount = 0;
  let incompleteCount = 0;
  let normalizedCount = 0;
  const output = lines.map((line) => {
    const normalized = taskLine(line, defaultStatus);
    if (!normalized.task) return line;
    taskCount += 1;
    if (normalized.hadCheckbox) checkboxCount += 1;
    if (normalized.checked) completedCount += 1;
    else incompleteCount += 1;
    if (normalized.line !== line) normalizedCount += 1;
    return normalized.line;
  }).join('\n');

  const blockers = [];
  if (String(text || '').trim() === '') blockers.push('tasks-md:empty');
  if (taskCount === 0) blockers.push('tasks-md:no-bullets');
  if (taskCount > 0 && checkboxCount === 0) blockers.push('tasks-md:no-checkboxes');
  if (checkboxCount > 0 && checkboxCount !== taskCount) blockers.push('tasks-md:mixed-checkboxes');
  if (incompleteCount > 0) blockers.push('tasks-md:incomplete-checkboxes');
  if (checkboxCount > 0 && completedCount === 0) blockers.push('tasks-md:no-completed-checkboxes');

  return {
    text: output.endsWith('\n') ? output : `${output}\n`,
    task_count: taskCount,
    checkbox_count: checkboxCount,
    completed_count: completedCount,
    incomplete_count: incompleteCount,
    normalized_count: normalizedCount,
    blockers
  };
}

function run(options = parseArgs()) {
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const root = path.resolve(options.project || process.env.PROJECT_DIR || process.env.PWD || process.cwd());
  if (options.errors.length) {
    emit({ ok: false, project_root: root, blockers: options.errors }, options.json);
    return 2;
  }
  const openSpec = lib.openspecDir(root);
  if (!fs.existsSync(openSpec) || !fs.statSync(openSpec).isDirectory()) {
    emit({ ok: false, project_root: root, blockers: ['missing-openspec'] }, options.json);
    return 2;
  }
  const active = activeChange(root, options.change);
  if (!active.ok) {
    emit({
      ok: false,
      project_root: root,
      active_change: active.change,
      change_resolution: active.state ? {
        source: active.state.source,
        candidates: active.state.candidates || [],
        blockers: active.state.blockers || []
      } : null,
      blockers: active.blockers
    }, options.json);
    return 2;
  }
  const file = path.join(active.dir, 'tasks.md');
  if (!fs.existsSync(file)) {
    emit({
      ok: false,
      project_root: root,
      active_change: active.change,
      path: file,
      blockers: ['missing-change-artifact:tasks.md']
    }, options.json);
    return 2;
  }
  const before = fs.readFileSync(file, 'utf8');
  const result = normalizeText(before, { defaultStatus: options.defaultStatus });
  const changed = result.text !== before;
  if (options.command === 'normalize' && changed && !options.dryRun) fs.writeFileSync(file, result.text);
  const remainingBlockers = options.command === 'normalize'
    ? result.blockers.filter((blocker) => !['tasks-md:no-checkboxes', 'tasks-md:mixed-checkboxes'].includes(blocker))
    : result.blockers;
  emit({
    ok: remainingBlockers.length === 0,
    command: options.command,
    project_root: root,
    active_change: active.change,
    path: file,
    changed: options.command === 'normalize' && changed && !options.dryRun,
    dry_run: options.dryRun,
    default_status: options.defaultStatus,
    task_count: result.task_count,
    checkbox_count: options.command === 'normalize' ? result.task_count : result.checkbox_count,
    completed_count: result.completed_count,
    incomplete_count: result.incomplete_count,
    normalized_count: result.normalized_count,
    blockers: remainingBlockers
  }, options.json);
  return remainingBlockers.length === 0 ? 0 : 2;
}

function emit(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!result.ok) {
    process.stderr.write(`tasks.md blocked: ${(result.blockers || []).join(', ')}\n`);
    return;
  }
  process.stdout.write(`${result.changed ? 'normalized' : 'valid'}: ${result.path}\n`);
}

if (require.main === module) process.exit(run());

module.exports = { normalizeText, run };
