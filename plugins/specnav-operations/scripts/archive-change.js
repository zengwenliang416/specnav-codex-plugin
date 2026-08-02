#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const childProcess = require('child_process');
const runtime = require('./plugin-runtime');
const { writeArchiveGate } = require('./operations-gate');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

function splitRawArgs(value) {
  return String(value || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const tokens = [...splitRawArgs(process.env.SPECNAV_ARCHIVE_ARGS), ...argv];
  const options = {
    project: null,
    change: null,
    skipSpecs: false,
    dryRun: false,
    json: false,
    help: false,
    errors: []
  };

  function readValue(flag, index) {
    const value = tokens[index + 1] || '';
    if (!value || value.startsWith('--')) {
      options.errors.push(`missing-option-value:${flag}`);
      return { value: null, nextIndex: index };
    }
    return { value, nextIndex: index + 1 };
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const arg = tokens[index];
    if (arg === 'archive') continue;
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
    if (arg === '--skip-specs') {
      options.skipSpecs = true;
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
    if (arg.startsWith('--change=')) {
      options.change = arg.slice('--change='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      options.errors.push(`unknown-option:${arg}`);
      continue;
    }
    if (!options.change) options.change = arg;
    else options.errors.push(`unexpected-argument:${arg}`);
  }

  return options;
}

function usage() {
  return [
    'Usage: node archive-change.js [--project <dir>] [--change <id>|<id>] [--skip-specs] [--dry-run] [--json]',
    '',
    'Runs the SpecNav archive sequence: normalize tasks.md, pass the operations archive gate,',
    'validate with openspec, run openspec archive, update change registry, and write an archive receipt.'
  ].join('\n');
}

function runNodeScript(script, args, cwd) {
  const result = childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
  return commandResult(result, [process.execPath, script, ...args]);
}

function runOpenSpec(root, args) {
  const bin = process.env.SPECNAV_OPENSPEC_BIN || 'openspec';
  const result = childProcess.spawnSync(bin, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
  return commandResult(result, [bin, ...args]);
}

function commandResult(result, command) {
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || null,
    command,
    stdout_tail: String(result.stdout || '').slice(-4000),
    stderr_tail: String(result.stderr || '').slice(-4000),
    error: result.error ? result.error.message : null
  };
}

function withSpecNavChange(change, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SPECNAV_CHANGE');
  const previous = process.env.SPECNAV_CHANGE;
  process.env.SPECNAV_CHANGE = change;
  try {
    return fn();
  } finally {
    if (had) process.env.SPECNAV_CHANGE = previous;
    else delete process.env.SPECNAV_CHANGE;
  }
}

function gitBranch(root, fallback = null) {
  const result = lib.runCommand('git branch --show-current', { cwd: root, timeoutMs: 10000 });
  const branch = result.ok ? result.stdout.trim() : '';
  return branch || fallback;
}

function archiveCandidates(root, change) {
  const archiveRoot = path.join(lib.openspecDir(root), 'changes', 'archive');
  return lib.listDirs(archiveRoot)
    .filter((dir) => path.basename(dir).endsWith(`-${change}`))
    .map((dir) => path.resolve(dir))
    .sort();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function captureEvidence(changeDir) {
  const files = [
    'verify/evidence/raw.jsonl',
    'verify/evidence/index.json',
    'verify/evidence-index.jsonl'
  ];
  return files.flatMap((relative) => {
    const file = path.join(changeDir, relative);
    if (!fs.existsSync(file)) return [];
    if (!fs.statSync(file).isFile()) {
      throw new Error(`verification-operations:archive-evidence-not-file:${relative}`);
    }
    return [{
      path: relative,
      sha256: sha256(fs.readFileSync(file))
    }];
  });
}

function verifyArchivedEvidence(archiveDir, captured) {
  const files = [];
  const blockers = [];
  for (const entry of captured) {
    const file = path.join(archiveDir, entry.path);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      blockers.push(`verification-operations:archive-evidence-missing:${entry.path}`);
      continue;
    }
    const digest = sha256(fs.readFileSync(file));
    files.push({ path: entry.path, sha256: digest });
    if (digest !== entry.sha256) {
      blockers.push(`verification-operations:archive-evidence-mutation:${entry.path}`);
    }
  }
  return {
    ok: blockers.length === 0,
    immutable: true,
    files,
    blockers
  };
}

function writeRegistryAfterArchive(root, change, archiveRel, beforeRegistry, archivedAt) {
  const activeIds = new Set(lib.listChangeIds(root));
  const existingById = new Map((beforeRegistry.changes || []).map((item) => [item.id, item]));
  const entries = [];
  let activeFileChange = null;
  try {
    activeFileChange = fs.readFileSync(path.join(lib.specnavDir(root), 'active-change'), 'utf8').trim();
  } catch {
    activeFileChange = null;
  }

  for (const id of Array.from(activeIds).sort()) {
    const previous = existingById.get(id) || {};
    entries.push({
      id,
      stage: lib.buildChangeRegistry(root).changes.find((item) => item.id === id)?.stage || previous.stage || 'active',
      status: 'active',
      branch: previous.branch || null,
      created_at: previous.created_at || null,
      last_active_at: previous.last_active_at || null
    });
  }

  for (const previous of beforeRegistry.changes || []) {
    if (!previous || previous.id === change || activeIds.has(previous.id)) continue;
    if (previous.status === 'archived' || previous.stage === 'archived') entries.push(previous);
  }

  const previousTarget = existingById.get(change) || {};
  entries.push({
    id: change,
    stage: 'archived',
    status: 'archived',
    branch: gitBranch(root, previousTarget.branch || null),
    created_at: previousTarget.created_at || null,
    last_active_at: archivedAt.slice(0, 10),
    archived_at: archivedAt,
    archive_path: archiveRel
  });

  const previousFocus = beforeRegistry.current_focus;
  const currentFocus = activeFileChange && activeIds.has(activeFileChange)
    ? activeFileChange
    : previousFocus && activeIds.has(previousFocus)
    ? previousFocus
    : Array.from(activeIds).sort()[0] || null;
  const registry = {
    schema_version: 1,
    current_focus: currentFocus,
    changes: entries.sort((a, b) => a.id.localeCompare(b.id))
  };
  lib.writeChangeRegistry(root, registry);
  return lib.buildChangeRegistry(root);
}

function updateActiveChangeFile(root, archivedChange, nextFocus) {
  const file = path.join(lib.specnavDir(root), 'active-change');
  let existing = null;
  try {
    existing = fs.readFileSync(file, 'utf8').trim();
  } catch {
    existing = null;
  }
  if (existing && existing !== archivedChange) {
    return { changed: false, path: path.relative(root, file).split(path.sep).join('/'), value: existing };
  }
  lib.ensureDir(path.dirname(file));
  if (nextFocus) {
    fs.writeFileSync(file, `${nextFocus}\n`);
    return { changed: true, path: path.relative(root, file).split(path.sep).join('/'), value: nextFocus };
  }
  try {
    fs.unlinkSync(file);
    return { changed: true, path: path.relative(root, file).split(path.sep).join('/'), value: null };
  } catch {
    return { changed: false, path: path.relative(root, file).split(path.sep).join('/'), value: null };
  }
}

function writeReceipt(root, archiveDir, receipt) {
  const opsDir = path.join(archiveDir, 'operations');
  lib.ensureDir(opsDir);
  lib.writeJson(path.join(opsDir, 'archive-receipt.json'), receipt);
  const lines = [
    '# SpecNav Archive Receipt',
    '',
    `- change: ${receipt.change}`,
    `- archive_path: ${receipt.archive_path}`,
    `- active_change_after: ${receipt.active_change_after || 'none'}`,
    `- openspec_validate: ${receipt.commands.openspec_validate.ok ? 'pass' : 'fail'}`,
    `- openspec_archive: ${receipt.commands.openspec_archive.ok ? 'pass' : 'fail'}`
  ];
  fs.writeFileSync(path.join(opsDir, 'archive-receipt.md'), `${lines.join('\n')}\n`);
}

function fail(result, json) {
  emit({ ok: false, ...result }, json);
  return 2;
}

function run(options = parseArgs()) {
  const root = path.resolve(options.project || process.env.PROJECT_DIR || process.env.PWD || process.cwd());
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.errors.length) return fail({ project_root: root, blockers: options.errors }, options.json);
  if (!fs.existsSync(lib.openspecDir(root))) return fail({ project_root: root, blockers: ['missing-openspec'] }, options.json);

  const changeState = options.change ? lib.activeChangeState(root, { change: options.change }) : lib.activeChangeState(root);
  const change = changeState.change;
  if (!change) {
    return fail({
      project_root: root,
      active_change: null,
      change_resolution: {
        source: changeState.source,
        candidates: changeState.candidates || [],
        blockers: changeState.blockers || []
      },
      blockers: changeState.blockers && changeState.blockers.length ? changeState.blockers : ['active-change']
    }, options.json);
  }

  const changeDir = lib.changeDir(root, change);
  if (!changeDir || !fs.existsSync(changeDir)) {
    return fail({ project_root: root, active_change: change, blockers: [`missing-change-dir:${change}`] }, options.json);
  }

  const beforeRegistry = lib.buildChangeRegistry(root);
  const beforeArchives = new Set(archiveCandidates(root, change));
  let evidenceBefore;
  try {
    evidenceBefore = captureEvidence(changeDir);
  } catch (error) {
    return fail({
      project_root: root,
      active_change: change,
      phase: 'archive-evidence-preflight',
      blockers: [error instanceof Error
        ? error.message
        : 'verification-operations:archive-evidence-preflight-failed']
    }, options.json);
  }
  const coreRoot = runtime.resolvePluginRoot('specnav-core');
  const tasksResult = runNodeScript(path.join(coreRoot, 'scripts', 'tasks-md.js'), [
    'normalize',
    '--project',
    root,
    '--change',
    change,
    '--json',
    ...(options.dryRun ? ['--dry-run'] : [])
  ], root);
  let tasksPayload = null;
  try {
    tasksPayload = JSON.parse(tasksResult.stdout_tail);
  } catch {
    tasksPayload = null;
  }
  if (!tasksResult.ok) {
    return fail({
      project_root: root,
      active_change: change,
      phase: 'tasks-md',
      blockers: tasksPayload && Array.isArray(tasksPayload.blockers) ? tasksPayload.blockers : ['tasks-md'],
      commands: { tasks_md: tasksResult }
    }, options.json);
  }

  const gate = withSpecNavChange(change, () => writeArchiveGate(root));
  if (!gate || gate.verdict !== 'green') {
    return fail({
      project_root: root,
      active_change: change,
      phase: 'archive-gate',
      blockers: gate && Array.isArray(gate.blockers) ? gate.blockers : ['archive-gate'],
      archive_gate: gate
    }, options.json);
  }

  if (options.dryRun) {
    emit({
      ok: true,
      dry_run: true,
      project_root: root,
      active_change: change,
      blockers: [],
      archive_gate: gate
    }, options.json);
    return 0;
  }

  const validateResult = runOpenSpec(root, ['--no-color', 'validate', change, '--type', 'change', '--strict', '--json', '--no-interactive']);
  if (!validateResult.ok) {
    return fail({
      project_root: root,
      active_change: change,
      phase: 'openspec-validate',
      blockers: ['openspec-validate'],
      commands: { openspec_validate: validateResult }
    }, options.json);
  }

  const archiveArgs = ['--no-color', 'archive', change, '--yes'];
  if (options.skipSpecs) archiveArgs.push('--skip-specs');
  const archiveResult = runOpenSpec(root, archiveArgs);
  if (!archiveResult.ok) {
    return fail({
      project_root: root,
      active_change: change,
      phase: 'openspec-archive',
      blockers: ['openspec-archive'],
      commands: { openspec_validate: validateResult, openspec_archive: archiveResult }
    }, options.json);
  }

  const newArchives = archiveCandidates(root, change)
    .filter((candidate) => !beforeArchives.has(candidate));
  if (newArchives.length !== 1) {
    return fail({
      project_root: root,
      active_change: change,
      phase: 'archive-discovery',
      blockers: [newArchives.length === 0
        ? 'archive-output-missing'
        : 'archive-output-ambiguous'],
      archive_candidates: newArchives.map((candidate) => (
        path.relative(root, candidate).split(path.sep).join('/')
      )),
      commands: { openspec_validate: validateResult, openspec_archive: archiveResult }
    }, options.json);
  }
  const archiveDir = newArchives[0];

  const archiveRel = path.relative(root, archiveDir).split(path.sep).join('/');
  const archivedAt = new Date().toISOString();
  const evidenceIntegrity = verifyArchivedEvidence(archiveDir, evidenceBefore);
  if (!evidenceIntegrity.ok) {
    return fail({
      project_root: root,
      active_change: change,
      phase: 'archive-evidence-integrity',
      blockers: evidenceIntegrity.blockers,
      archive_path: archiveRel,
      commands: { openspec_validate: validateResult, openspec_archive: archiveResult }
    }, options.json);
  }
  const registry = writeRegistryAfterArchive(root, change, archiveRel, beforeRegistry, archivedAt);
  const activeFile = updateActiveChangeFile(root, change, registry.current_focus);
  const receipt = {
    schema: 'specnav.ops.archiveReceipt.v1',
    archived_at: archivedAt,
    change,
    archive_path: archiveRel,
    active_change_after: registry.current_focus,
    skip_specs: options.skipSpecs,
    tasks_md: tasksPayload,
    archive_gate: gate,
    evidence_integrity: evidenceIntegrity,
    registry: {
      path: path.relative(root, lib.changeRegistryFile(root)).split(path.sep).join('/'),
      current_focus: registry.current_focus
    },
    active_change_file: activeFile,
    commands: {
      openspec_validate: validateResult,
      openspec_archive: archiveResult
    }
  };
  writeReceipt(root, archiveDir, receipt);
  lib.event(root, 'operations.archive-change', {
    change,
    archive_path: archiveRel,
    active_change_after: registry.current_focus
  });

  emit({
    ok: true,
    project_root: root,
    active_change: change,
    archive_path: archiveRel,
    active_change_after: registry.current_focus,
    blockers: [],
    receipt_path: `${archiveRel}/operations/archive-receipt.json`,
    evidence_integrity: evidenceIntegrity,
    commands: {
      openspec_validate: validateResult,
      openspec_archive: archiveResult
    }
  }, options.json);
  return 0;
}

function emit(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!result.ok) {
    process.stderr.write(`SpecNav archive blocked: ${(result.blockers || []).join(', ')}\n`);
    return;
  }
  process.stdout.write(`SpecNav archived ${result.active_change} to ${result.archive_path}\n`);
}

if (require.main === module) process.exit(run());

module.exports = { parseArgs, run, splitRawArgs };
