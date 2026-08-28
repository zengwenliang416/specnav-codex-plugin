#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  resolveManagedValidationReceiptAuthority
} = require('./development-receipt-authority');

const TASK_ID_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPAIR_TASK_SCHEMA = 'specnav.development.repair-task.v1';
const ACCEPTANCE_SCHEMA = 'specnav.task-acceptance-evidence.v2';
const INPUT_SCHEMA = 'specnav.task-acceptance-input.v1';
const INPUT_SET_SCHEMA = 'specnav.task-acceptance-input-set.v1';
const GENERATOR_ID = 'specnav-development/task-acceptance-evidence';

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file, root) {
  if (!safeRegularFile(root, file)) {
    throw new Error('task-acceptance:validation-log-unsafe');
  }
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter((entry) => entry.raw.trim() !== '')
    .map((entry) => {
      try {
        return {
          ...entry,
          value: JSON.parse(entry.raw)
        };
      } catch {
        throw new Error(`task-acceptance:invalid-validation-log-json:${entry.line}`);
      }
    })
    .map((entry) => {
      if (
        !entry.value
        || typeof entry.value !== 'object'
        || Array.isArray(entry.value)
      ) {
        throw new Error(`task-acceptance:invalid-validation-log-json:${entry.line}`);
      }
      return entry;
    });
}

function unique(values) {
  return [...new Set(values.filter(
    (value) => typeof value === 'string' && value.trim() !== ''
  ))];
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function normalizeRelative(value) {
  return String(value).split(path.sep).join('/').replace(/^\.\//, '');
}

function isCleanRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const normalized = normalizeRelative(value);
  return (
    normalized === value
    && !path.posix.isAbsolute(normalized)
    && !normalized.split('/').includes('..')
  );
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && !relative.startsWith('..')
    && !path.isAbsolute(relative);
}

function safeRegularFile(root, candidate) {
  try {
    const rootReal = fs.realpathSync(root);
    const status = fs.lstatSync(candidate);
    return (
      !status.isSymbolicLink()
      && status.isFile()
      && isContained(rootReal, fs.realpathSync(candidate))
    );
  } catch {
    return false;
  }
}

function assertSafeExistingDirectoryTree(root, target, blocker) {
  const relative = path.relative(root, target);
  if (
    relative === ''
    || relative.startsWith('..')
    || path.isAbsolute(relative)
  ) {
    throw new Error(blocker);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const status = fs.lstatSync(current);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(blocker);
    }
  }
  if (!isContained(fs.realpathSync(root), fs.realpathSync(target))) {
    throw new Error(blocker);
  }
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

function git(projectRoot, args) {
  try {
    return execFileSync('git', ['-C', projectRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch {
    throw new Error(`task-acceptance:git-command-failed:${args.join(':')}`);
  }
}

function reviewedGitSnapshot(projectRoot) {
  const head = git(projectRoot, ['rev-parse', 'HEAD']);
  const tree = git(projectRoot, ['rev-parse', 'HEAD^{tree}']);
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error('task-acceptance:invalid-reviewed-git-snapshot');
  }
  return { head, tree };
}

function isLifecyclePath(relativePath, changeId) {
  const normalized = normalizeRelative(relativePath);
  const changePrefix = `openspec/changes/${changeId}/`;
  return (
    normalized.startsWith('openspec/.specnav/')
    ||
    ['development/', 'verify/', 'codegraph/', 'operations/']
      .some((directory) => normalized.startsWith(`${changePrefix}${directory}`))
    || normalized.startsWith(`${changePrefix}verify-report.`)
    || normalized === `openspec/changes/${changeId}/tasks.md`
  );
}

function assertNoDirtyImplementation(projectRoot, changeId) {
  const changed = unique([
    ...git(projectRoot, ['diff', '--name-only', 'HEAD', '--']).split(/\r?\n/),
    ...git(projectRoot, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/)
  ]);
  const dirtyImplementation = changed.filter(
    (relative) => relative && !isLifecyclePath(relative, changeId)
  );
  if (dirtyImplementation.length > 0) {
    throw new Error(
      `task-acceptance:dirty-implementation-scope:${dirtyImplementation.join(',')}`
    );
  }
}

function globPattern(pattern) {
  let result = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      result += '.*';
      index += 1;
    } else if (char === '*') {
      result += '[^/]*';
    } else if (char === '?') {
      result += '[^/]';
    } else {
      result += char.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
    }
  }
  return new RegExp(`${result}$`);
}

function gitTreeEntries(projectRoot) {
  const output = git(projectRoot, ['ls-tree', '-r', '--full-tree', 'HEAD']);
  if (!output) return [];
  return output.split(/\r?\n/).map((line) => {
    const [metadata, relativePath] = line.split('\t');
    const [mode, type, objectId] = metadata.split(' ');
    return {
      path: normalizeRelative(relativePath),
      mode,
      type,
      object_id: objectId
    };
  });
}

function implementationScopeBinding(projectRoot, changeId, context) {
  const patterns = unique(
    Array.isArray(context.allowed_files) ? context.allowed_files : []
  )
    .map(normalizeRelative)
    .filter((pattern) => !isLifecyclePath(pattern, changeId))
    .sort();
  if (patterns.some((pattern) => !isCleanRelativePath(pattern))) {
    throw new Error(`task-acceptance:invalid-implementation-scope:${context.task_id}`);
  }
  if (patterns.length === 0) {
    throw new Error(`task-acceptance:no-implementation-scope:${context.task_id}`);
  }

  const matchers = patterns.map(globPattern);
  const entries = gitTreeEntries(projectRoot)
    .filter((entry) => matchers.some((matcher) => matcher.test(entry.path)))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length === 0) {
    throw new Error(`task-acceptance:empty-implementation-scope:${context.task_id}`);
  }

  return {
    included_patterns: patterns,
    entries,
    sha256: sha256(JSON.stringify(canonicalize({ patterns, entries })))
  };
}

function headingValue(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const expected = heading.trim().toLowerCase();
  const index = lines.findIndex((line) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    return match && match[1].trim().toLowerCase() === expected;
  });
  if (index < 0) return null;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (/^##\s+/.test(lines[cursor])) break;
    const value = lines[cursor].trim();
    if (value !== '') return value;
  }
  return null;
}

function artifactBinding(changeDir, relativePath, field, heading, expected) {
  if (!isCleanRelativePath(relativePath)) {
    throw new Error(`task-acceptance:invalid-${field}-path`);
  }
  const file = path.resolve(changeDir, relativePath);
  const containment = path.relative(changeDir, file);
  if (
    containment === ''
    || containment.startsWith('..')
    || path.isAbsolute(containment)
    || !safeRegularFile(changeDir, file)
  ) {
    throw new Error(`task-acceptance:missing-${field}`);
  }
  const markdown = fs.readFileSync(file, 'utf8');
  const binding = {
    path: relativePath,
    sha256: sha256(Buffer.from(markdown))
  };
  if (heading) {
    const value = headingValue(markdown, heading);
    if (value !== expected) {
      throw new Error(`task-acceptance:${field}-${heading.toLowerCase()}:${String(value)}`);
    }
    binding[heading.toLowerCase()] = value;
  }
  return binding;
}

function resolveEvidenceFile(projectRoot, changeDir, relativePath, taskId) {
  if (!isCleanRelativePath(relativePath)) {
    throw new Error(`task-acceptance:invalid-evidence-path:${taskId}:${String(relativePath)}`);
  }
  const changeRelativePrefixes = [
    'codegraph/',
    'development/',
    'operations/',
    'prototype/',
    'verify/'
  ];
  const root = changeRelativePrefixes.some((prefix) => relativePath.startsWith(prefix))
    ? changeDir
    : projectRoot;
  const file = path.resolve(root, relativePath);
  if (!safeRegularFile(root, file)) {
    throw new Error(`task-acceptance:missing-evidence-path:${taskId}:${relativePath}`);
  }
  return {
    path: relativePath,
    sha256: sha256File(file),
    size: fs.statSync(file).size
  };
}

function normalizeTaskInput(taskId, input, assertionIds) {
  if (input == null) return null;
  const allowedInputFields = new Set(['schema', 'task_id', 'assertions']);
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some((field) => !allowedInputFields.has(field))
    || input.schema !== INPUT_SCHEMA
    || input.task_id !== taskId
    || !input.assertions
    || typeof input.assertions !== 'object'
    || Array.isArray(input.assertions)
  ) {
    throw new Error(`task-acceptance:invalid-structured-input:${taskId}`);
  }
  const declared = Object.keys(input.assertions).sort();
  const expected = [...assertionIds].sort();
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    throw new Error(`task-acceptance:structured-input-assertion-mismatch:${taskId}`);
  }
  const allowedAssertionFields = new Set([
    'test_run_ids',
    'direct_evidence',
    'reused_evidence'
  ]);
  for (const id of expected) {
    const configured = input.assertions[id];
    if (
      !configured
      || typeof configured !== 'object'
      || Array.isArray(configured)
      || Object.keys(configured).some((field) => !allowedAssertionFields.has(field))
      || !Array.isArray(configured.test_run_ids)
      || configured.test_run_ids.length === 0
      || unique(configured.test_run_ids).length !== configured.test_run_ids.length
      || !Array.isArray(configured.direct_evidence)
      || !Array.isArray(configured.reused_evidence)
    ) {
      throw new Error(`task-acceptance:invalid-assertion-input:${taskId}:${id}`);
    }
    if (
      configured.reused_evidence.some((entry) => (
        !entry
        || typeof entry !== 'object'
        || Array.isArray(entry)
        || Object.keys(entry).some((field) => !['task_id', 'path'].includes(field))
        || !TASK_ID_PATTERN.test(entry.task_id)
        || !isCleanRelativePath(entry.path)
      ))
    ) {
      throw new Error(`task-acceptance:invalid-reused-evidence:${taskId}:${id}`);
    }
  }
  return input;
}

function validationRuns(options) {
  const {
    projectRoot,
    changeDir,
    taskId,
    assertionIds,
    validationEntries,
    reviewedGit,
    receiptAuthority
  } = options;
  const assertionSet = new Set(assertionIds);
  const seen = new Set();
  const runs = [];

  for (const receipt of validationEntries) {
    const entry = receipt.value;
    if (entry.task !== taskId || entry.status !== 'pass' || entry.overturned === true) {
      continue;
    }
    if (entry.reviewed_git_head !== reviewedGit.head) {
      continue;
    }
    if (entry.reviewed_git_tree !== reviewedGit.tree) {
      throw new Error(`task-acceptance:invalid-validation-receipt:${taskId}:${receipt.line}`);
    }
    if (
      entry.ok !== true
      || entry.exit_status !== 0
      || entry.attestation !== 'system-executed'
      || !receiptAuthority.verify(entry)
      || typeof entry.receipt_id !== 'string'
      || entry.receipt_id.trim() === ''
      || typeof entry.command !== 'string'
      || entry.command.trim() === ''
      || typeof entry.recorded_at !== 'string'
      || Number.isNaN(Date.parse(entry.recorded_at))
      || !Array.isArray(entry.assertion_ids)
      || entry.assertion_ids.length === 0
      || typeof entry.evidence_log !== 'string'
      || typeof entry.evidence_log_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(entry.evidence_log_sha256)
      || !Number.isInteger(entry.evidence_log_size)
      || entry.evidence_log_size < 0
    ) {
      throw new Error(`task-acceptance:invalid-validation-receipt:${taskId}:${receipt.line}`);
    }
    if (seen.has(entry.receipt_id)) {
      throw new Error(`task-acceptance:duplicate-receipt-id:${taskId}:${entry.receipt_id}`);
    }
    const mappedAssertions = unique(entry.assertion_ids);
    if (
      mappedAssertions.length !== entry.assertion_ids.length
      || mappedAssertions.some((id) => !assertionSet.has(id))
    ) {
      throw new Error(`task-acceptance:invalid-receipt-assertions:${taskId}:${entry.receipt_id}`);
    }
    const evidenceLog = resolveEvidenceFile(
      projectRoot,
      changeDir,
      entry.evidence_log,
      taskId
    );
    if (
      evidenceLog.sha256 !== entry.evidence_log_sha256
      || evidenceLog.size !== entry.evidence_log_size
    ) {
      throw new Error(
        `task-acceptance:evidence-log-binding-mismatch:${taskId}:${entry.receipt_id}`
      );
    }
    seen.add(entry.receipt_id);
    runs.push({
      id: entry.receipt_id,
      command: entry.command,
      assertion_ids: mappedAssertions,
      recorded_at: entry.recorded_at,
      validation_receipt_sha256: sha256(Buffer.from(receipt.raw)),
      evidence_log: evidenceLog
    });
  }
  if (runs.length === 0) {
    throw new Error(`task-acceptance:no-system-pass:${taskId}`);
  }
  return runs.sort((left, right) => left.id.localeCompare(right.id));
}

function evidenceInputForTask(taskEvidenceInputs, taskId) {
  if (!taskEvidenceInputs) return null;
  return taskEvidenceInputs[taskId] || null;
}

function buildTaskAcceptance(options) {
  const {
    projectRoot,
    changeDir,
    changeId,
    taskId,
    context,
    parentAssertions,
    validationEntries,
    reviewedGit,
    receiptAuthority,
    taskEvidenceInput,
    now = () => new Date()
  } = options;
  const ids = taskAssertionIds(context);
  if (ids.length === 0) {
    throw new Error(`task-acceptance:no-assertions:${taskId}`);
  }
  const input = normalizeTaskInput(taskId, taskEvidenceInput, ids);
  const testRuns = validationRuns({
    projectRoot,
    changeDir,
    taskId,
    assertionIds: ids,
    validationEntries,
    reviewedGit,
    receiptAuthority
  });
  const runsById = new Map(testRuns.map((run) => [run.id, run]));
  const scope = implementationScopeBinding(projectRoot, changeId, context);
  const taskPrefix = `development/tasks/${taskId}`;
  const artifacts = {
    context: artifactBinding(
      changeDir,
      `${taskPrefix}/context.json`,
      'context'
    ),
    report: artifactBinding(
      changeDir,
      `${taskPrefix}/report.md`,
      'report',
      'Status',
      'DONE'
    ),
    spec_review: artifactBinding(
      changeDir,
      `${taskPrefix}/spec-review.md`,
      'spec-review',
      'Verdict',
      'approved'
    ),
    quality_review: artifactBinding(
      changeDir,
      `${taskPrefix}/quality-review.md`,
      'quality-review',
      'Verdict',
      'approved'
    )
  };

  const assertions = ids.map((id) => {
    const configured = input ? input.assertions[id] : null;
    const testRunIds = configured
      ? configured.test_run_ids
      : testRuns.filter((run) => run.assertion_ids.includes(id)).map((run) => run.id);
    if (
      testRunIds.length === 0
      || testRunIds.some((runId) => (
        !runsById.has(runId)
        || !runsById.get(runId).assertion_ids.includes(id)
      ))
    ) {
      throw new Error(`task-acceptance:missing-explicit-test-run:${taskId}:${id}`);
    }
    const directPaths = configured
      ? configured.direct_evidence
      : [];
    const reusedInputs = configured
      ? configured.reused_evidence
      : [];
    const reusedEvidence = reusedInputs.map((entry) => {
      return {
        task_id: entry.task_id,
        ...resolveEvidenceFile(projectRoot, changeDir, entry.path, taskId)
      };
    });
    return {
      id,
      parent_id: parentAssertionId(id),
      status: 'passing',
      test_run_ids: testRunIds,
      direct_evidence: directPaths.map((relative) => (
        resolveEvidenceFile(projectRoot, changeDir, relative, taskId)
      )),
      reused_evidence: reusedEvidence,
      claim: claimFor(id, context, parentAssertions)
    };
  });

  const recordedAt = testRuns
    .map((run) => run.recorded_at)
    .sort()
    .at(-1);
  return {
    schema: ACCEPTANCE_SCHEMA,
    generated_by: GENERATOR_ID,
    task_id: taskId,
    generated_at: now().toISOString(),
    recorded_at: recordedAt,
    status: 'approved',
    reviewed_git_head: reviewedGit.head,
    reviewed_git_tree: reviewedGit.tree,
    implementation_scope: scope,
    artifacts,
    test_runs: testRuns,
    assertions,
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

function loadTaskEvidenceInputs(file) {
  if (!file) return {};
  const value = readJson(path.resolve(file));
  const allowedFields = new Set(['schema', 'tasks']);
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).some((field) => !allowedFields.has(field))
    || value.schema !== INPUT_SET_SCHEMA
    || !value.tasks
    || typeof value.tasks !== 'object'
    || Array.isArray(value.tasks)
  ) {
    throw new Error('task-acceptance:invalid-input-set');
  }
  return value.tasks;
}

function materialize(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const changeId = options.changeId;
  if (!changeId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(changeId)) {
    throw new Error('task-acceptance:change-required');
  }
  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeId);
  const tasksDir = path.join(changeDir, 'development', 'tasks');
  assertSafeExistingDirectoryTree(
    projectRoot,
    changeDir,
    'task-acceptance:change-directory-unsafe'
  );
  const reviewedGit = reviewedGitSnapshot(projectRoot);
  assertNoDirtyImplementation(projectRoot, changeId);
  const receiptAuthority = options.receiptAuthority
    || resolveManagedValidationReceiptAuthority({
      projectRoot,
      changeDir
    });
  const parentAcceptance = readJson(path.join(changeDir, 'acceptance.json'));
  const parentAssertions = new Map(
    (Array.isArray(parentAcceptance.assertions)
      ? parentAcceptance.assertions
      : []).map((entry) => [entry.id, entry])
  );
  const validationEntries = readJsonl(
    path.join(changeDir, 'development', 'validation-log.jsonl'),
    changeDir
  );
  const taskEvidenceInputs = options.taskEvidenceInputs || {};
  const taskEntries = fs.readdirSync(tasksDir)
    .filter((entry) => {
      const taskDir = path.join(tasksDir, entry);
      return fs.statSync(taskDir).isDirectory();
    })
    .sort();
  const tasks = [];
  for (const taskId of taskEntries) {
    const taskDir = path.join(tasksDir, taskId);
    const context = readJson(path.join(taskDir, 'context.json'));
    if (
      context
      && typeof context === 'object'
      && !Array.isArray(context)
      && context.schema === REPAIR_TASK_SCHEMA
    ) {
      continue;
    }
    if (
      !context
      || typeof context !== 'object'
      || Array.isArray(context)
      || Object.prototype.hasOwnProperty.call(context, 'schema')
    ) {
      throw new Error(`task-acceptance:invalid-context-schema:${taskId}`);
    }
    if (!TASK_ID_PATTERN.test(taskId)) {
      throw new Error(`task-acceptance:invalid-task-id:${taskId}`);
    }
    if (context.task_id !== taskId) {
      throw new Error(`task-acceptance:context-task-mismatch:${taskId}`);
    }
    tasks.push({ taskId, taskDir, context });
  }
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const unknownInputTask = Object.keys(taskEvidenceInputs).find(
    (taskId) => !taskIds.has(taskId)
  );
  if (unknownInputTask) {
    throw new Error(`task-acceptance:unknown-input-task:${unknownInputTask}`);
  }

  const written = [];
  const existing = [];
  for (const task of tasks) {
    const { taskId, taskDir, context } = task;
    const file = path.join(taskDir, 'acceptance.json');
    let current = null;
    if (fs.existsSync(file)) {
      current = readJson(file);
      if (current.schema === 'specnav.task-acceptance-evidence.v1' && options.force !== true) {
        throw new Error(`task-acceptance:v1-rejected:${taskId}`);
      }
      if (current.schema !== ACCEPTANCE_SCHEMA && current.schema !== 'specnav.task-acceptance-evidence.v1') {
        throw new Error(`task-acceptance:unsupported-existing-schema:${taskId}`);
      }
    }
    const value = buildTaskAcceptance({
      projectRoot,
      changeDir,
      changeId,
      taskId,
      context,
      parentAssertions,
      validationEntries,
      reviewedGit,
      receiptAuthority,
      taskEvidenceInput: evidenceInputForTask(taskEvidenceInputs, taskId),
      now: options.now
    });
    if (current?.schema === ACCEPTANCE_SCHEMA && options.force !== true) {
      const currentGeneratedAt = current.generated_at;
      if (
        typeof currentGeneratedAt !== 'string'
        || Number.isNaN(Date.parse(currentGeneratedAt))
      ) {
        throw new Error(`task-acceptance:invalid-existing-v2:${taskId}`);
      }
      const normalizedExpected = {
        ...value,
        generated_at: currentGeneratedAt
      };
      if (
        JSON.stringify(canonicalize(current))
        !== JSON.stringify(canonicalize(normalizedExpected))
      ) {
        throw new Error(`task-acceptance:invalid-existing-v2:${taskId}`);
      }
      existing.push(normalizeRelative(path.relative(projectRoot, file)));
      continue;
    }
    if (options.write === true) writeJsonAtomic(file, value);
    written.push({
      task_id: taskId,
      file: normalizeRelative(path.relative(projectRoot, file)),
      assertion_ids: value.assertions.map((entry) => entry.id),
      test_run_count: value.test_runs.length,
      recorded_at: value.recorded_at,
      reviewed_git_head: value.reviewed_git_head
    });
  }
  return {
    ok: true,
    status: options.write === true ? 'materialized' : 'planned',
    change_id: changeId,
    reviewed_git_head: reviewedGit.head,
    reviewed_git_tree: reviewedGit.tree,
    task_count: tasks.length,
    written,
    existing,
    fallback_used: false
  };
}

function main() {
  const args = process.argv.slice(2);
  const action = args[0] && !args[0].startsWith('--') ? args[0] : 'plan';
  if (!['plan', 'write'].includes(action)) {
    throw new Error(`task-acceptance:unsupported-action:${action}`);
  }
  const result = materialize({
    projectRoot: argValue(args, '--project', process.cwd()),
    changeId: argValue(args, '--change'),
    write: action === 'write',
    force: args.includes('--force'),
    taskEvidenceInputs: loadTaskEvidenceInputs(argValue(args, '--input'))
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
  ACCEPTANCE_SCHEMA,
  INPUT_SCHEMA,
  buildTaskAcceptance,
  canonicalize,
  implementationScopeBinding,
  materialize,
  parentAssertionId,
  sha256,
  taskAssertionIds
};
