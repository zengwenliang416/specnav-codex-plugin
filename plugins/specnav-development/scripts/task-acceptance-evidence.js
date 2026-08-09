#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TASK_ID_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

function unique(values) {
  return [...new Set(values.filter(
    (value) => typeof value === 'string' && value.trim() !== ''
  ))];
}

function taskAssertionIds(context) {
  const scoped = unique([
    ...(Array.isArray(context.acceptance_primary)
      ? context.acceptance_primary
      : []),
    ...(Array.isArray(context.acceptance_subclaims)
      ? context.acceptance_subclaims
      : [])
  ]);
  if (scoped.length > 0) return scoped;
  const declared = unique(
    Array.isArray(context.acceptance_assertions)
      ? context.acceptance_assertions
      : []
  );
  if (declared.length > 0) return declared;
  return unique([
    ...(Array.isArray(context.acceptance_contributes)
      ? context.acceptance_contributes
      : []),
    ...(Array.isArray(context.contributes_to)
      ? context.contributes_to
      : [])
  ]);
}

function parentAssertionId(id) {
  return String(id).split(':', 1)[0];
}

function evidenceForTask(changeDir, taskId, validationEntries) {
  const taskPrefix = `development/tasks/${taskId}`;
  const evidence = [
    `${taskPrefix}/report.md`,
    `${taskPrefix}/spec-review.md`,
    `${taskPrefix}/quality-review.md`
  ];
  for (const entry of validationEntries) {
    if (
      entry.task !== taskId
      || entry.status !== 'pass'
      || entry.ok !== true
      || entry.exit_status !== 0
      || entry.attestation !== 'system-executed'
      || entry.overturned === true
      || typeof entry.evidence_log !== 'string'
    ) {
      continue;
    }
    evidence.push(entry.evidence_log);
  }
  return unique(evidence).filter((relative) => {
    const resolved = path.resolve(changeDir, relative);
    const containment = path.relative(changeDir, resolved);
    return (
      containment !== ''
      && !containment.startsWith('..')
      && !path.isAbsolute(containment)
      && fs.existsSync(resolved)
      && fs.statSync(resolved).isFile()
    );
  });
}

function claimFor(id, context, parentAssertions) {
  const parent = parentAssertions.get(parentAssertionId(id));
  if (!id.includes(':') && parent) return parent.statement;
  const expected = Array.isArray(context.expected_evidence)
    ? context.expected_evidence.find((entry) => (
        typeof entry === 'string' && entry.includes(id)
      ))
    : null;
  return expected || `${context.goal} (${id})`;
}

function recordedAtFor(taskId, validationEntries) {
  const timestamps = validationEntries
    .filter((entry) => (
      entry.task === taskId
      && entry.status === 'pass'
      && entry.ok === true
      && entry.attestation === 'system-executed'
      && entry.overturned !== true
      && typeof entry.recorded_at === 'string'
      && !Number.isNaN(Date.parse(entry.recorded_at))
    ))
    .map((entry) => entry.recorded_at)
    .sort();
  return timestamps.at(-1) || null;
}

function buildTaskAcceptance(options) {
  const {
    changeDir,
    taskId,
    context,
    parentAssertions,
    validationEntries
  } = options;
  const ids = taskAssertionIds(context);
  if (ids.length === 0) {
    throw new Error(`task-acceptance:no-assertions:${taskId}`);
  }
  const evidence = evidenceForTask(changeDir, taskId, validationEntries);
  if (evidence.length === 0) {
    throw new Error(`task-acceptance:no-system-evidence:${taskId}`);
  }
  const recordedAt = recordedAtFor(taskId, validationEntries);
  if (!recordedAt) {
    throw new Error(`task-acceptance:no-system-pass:${taskId}`);
  }
  return {
    schema: 'specnav.task-acceptance-evidence.v1',
    generated_by: 'specnav-development/task-acceptance-evidence',
    task_id: taskId,
    recorded_at: recordedAt,
    status: 'approved',
    assertions: ids.map((id) => ({
      id,
      parent_id: parentAssertionId(id),
      status: 'passing',
      direct_evidence: evidence,
      reused_evidence: [],
      claim: claimFor(id, context, parentAssertions)
    })),
    fallback_used: false
  };
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600
  });
  fs.renameSync(temporary, file);
}

function materialize(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const changeId = options.changeId;
  if (!changeId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(changeId)) {
    throw new Error('task-acceptance:change-required');
  }
  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeId);
  const tasksDir = path.join(changeDir, 'development', 'tasks');
  const parentAcceptance = readJson(path.join(changeDir, 'acceptance.json'));
  const parentAssertions = new Map(
    (Array.isArray(parentAcceptance.assertions)
      ? parentAcceptance.assertions
      : []).map((entry) => [entry.id, entry])
  );
  const validationEntries = readJsonl(path.join(
    changeDir,
    'development',
    'validation-log.jsonl'
  ));
  const taskIds = fs.readdirSync(tasksDir)
    .filter((entry) => {
      const taskDir = path.join(tasksDir, entry);
      return fs.statSync(taskDir).isDirectory();
    })
    .sort();
  const written = [];
  const existing = [];
  for (const taskId of taskIds) {
    if (!TASK_ID_PATTERN.test(taskId)) {
      throw new Error(`task-acceptance:invalid-task-id:${taskId}`);
    }
    const taskDir = path.join(tasksDir, taskId);
    const file = path.join(taskDir, 'acceptance.json');
    if (fs.existsSync(file)) {
      const current = readJson(file);
      const generated = (
        current.generated_by
        === 'specnav-development/task-acceptance-evidence'
      );
      if (
        options.force !== true
        || (
          current.schema === 'specnav.task-acceptance-evidence.v1'
          && !generated
          && Array.isArray(current.reused_task_range)
        )
      ) {
        existing.push(path.relative(projectRoot, file).split(path.sep).join('/'));
        continue;
      }
    }
    const context = readJson(path.join(taskDir, 'context.json'));
    if (context.task_id !== taskId) {
      throw new Error(`task-acceptance:context-task-mismatch:${taskId}`);
    }
    const value = buildTaskAcceptance({
      changeDir,
      taskId,
      context,
      parentAssertions,
      validationEntries
    });
    if (options.write === true) writeJsonAtomic(file, value);
    written.push({
      task_id: taskId,
      file: path.relative(projectRoot, file).split(path.sep).join('/'),
      assertion_ids: value.assertions.map((entry) => entry.id),
      evidence_count: value.assertions[0].direct_evidence.length,
      recorded_at: value.recorded_at
    });
  }
  return {
    ok: true,
    status: options.write === true ? 'materialized' : 'planned',
    change_id: changeId,
    task_count: taskIds.length,
    written,
    existing,
    fallback_used: false
  };
}

function main() {
  const args = process.argv.slice(2);
  const action = args.find((entry) => !entry.startsWith('--')) || 'plan';
  if (!['plan', 'write'].includes(action)) {
    throw new Error(`task-acceptance:unsupported-action:${action}`);
  }
  const result = materialize({
    projectRoot: argValue(args, '--project', process.cwd()),
    changeId: argValue(args, '--change'),
    write: action === 'write',
    force: args.includes('--force')
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      blockers: [error instanceof Error ? error.message : String(error)],
      fallback_used: false
    }, null, 2)}\n`);
    process.exit(2);
  }
}

module.exports = {
  buildTaskAcceptance,
  materialize,
  parentAssertionId,
  taskAssertionIds
};
