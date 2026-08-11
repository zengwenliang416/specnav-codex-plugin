#!/usr/bin/env node
'use strict';

// Replays validation-log commands and records system-executed receipts.
// Self-reported entries are claims; entries written here are facts: the
// runner executes the command itself and attests the observed exit status.
// Contract scripts treat only these entries as executed evidence.

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const {
  resolveManagedValidationReceiptAuthority
} = require('./validation-receipt-authority');

const RUNNER_ID = 'specnav-evidence-runner';
const REFRESH_CURRENT_HEAD_MODE = 'refresh-current-head';
const ADJUDICATE_CURRENT_HEAD_MODE = 'adjudicate-current-head';
const DEFAULT_TIMEOUT_MS = 900000;
const REPAIR_TASK_SCHEMA = 'specnav.development.repair-task.v1';
const TASK_ID_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEAD_TAIL_CHARS = 2000;

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function headTail(text) {
  if (typeof text !== 'string') return '';
  if (text.length <= HEAD_TAIL_CHARS * 2) return text;
  return `${text.slice(0, HEAD_TAIL_CHARS)}\n...[truncated ${text.length - HEAD_TAIL_CHARS * 2} chars]...\n${text.slice(-HEAD_TAIL_CHARS)}`;
}

function taskSlug(entry, index) {
  const raw = String(entry.task || entry.task_id || `entry-${index + 1}`);
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `entry-${index + 1}`;
}

function parseLog(file) {
  const entries = [];
  let status;
  try {
    status = fs.lstatSync(file);
  } catch {
    throw new Error('evidence-runner:validation-log-missing');
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error('evidence-runner:validation-log-unsafe');
  }
  const text = fs.readFileSync(file, 'utf8');
  if (!text) return entries;
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        entries.push({ entry, line: index + 1 });
        return;
      }
    } catch {
      // The error below is intentionally uniform for invalid JSON and shape.
    }
    throw new Error(`evidence-runner:invalid-validation-log-json:${index + 1}`);
  });
  return entries;
}

function unique(values) {
  return [...new Set(values.filter(
    (value) => typeof value === 'string' && value.trim() !== ''
  ))];
}

function git(projectRoot, args) {
  try {
    return execFileSync('git', ['-C', projectRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch {
    throw new Error(`evidence-runner:git-command-failed:${args.join(':')}`);
  }
}

function reviewedGitSnapshot(projectRoot) {
  const head = git(projectRoot, ['rev-parse', 'HEAD']);
  const tree = git(projectRoot, ['rev-parse', 'HEAD^{tree}']);
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error('evidence-runner:invalid-reviewed-git-snapshot');
  }
  return { head, tree };
}

function normalizeRelative(value) {
  return String(value).split(path.sep).join('/').replace(/^\.\//, '');
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && !relative.startsWith('..')
    && !path.isAbsolute(relative);
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

function assertSafeDirectoryTree(root, target, blocker) {
  const rootReal = fs.realpathSync(root);
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
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const status = fs.lstatSync(current);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(blocker);
    }
  }
  if (!isContained(rootReal, fs.realpathSync(target))) {
    throw new Error(blocker);
  }
}

function isSafeEvidenceFile(changeDir, evidenceLog) {
  if (
    typeof evidenceLog !== 'string'
    || normalizeRelative(evidenceLog) !== evidenceLog
    || !evidenceLog.startsWith('development/evidence/')
    || path.posix.isAbsolute(evidenceLog)
    || evidenceLog.split('/').includes('..')
  ) {
    return false;
  }
  const evidenceFile = path.resolve(changeDir, evidenceLog);
  try {
    const changeReal = fs.realpathSync(changeDir);
    const status = fs.lstatSync(evidenceFile);
    return (
      !status.isSymbolicLink()
      && status.isFile()
      && isContained(changeReal, fs.realpathSync(evidenceFile))
    );
  } catch {
    return false;
  }
}

function evidenceFileBinding(changeDir, evidenceLog) {
  if (!isSafeEvidenceFile(changeDir, evidenceLog)) return null;
  const file = path.resolve(changeDir, evidenceLog);
  const content = fs.readFileSync(file);
  return {
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    size: content.length
  };
}

function appendReceipt(logFile, receipt) {
  const flags = fs.constants.O_APPEND
    | fs.constants.O_WRONLY
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(logFile, flags);
  try {
    const status = fs.fstatSync(fd);
    if (!status.isFile()) {
      throw new Error('evidence-runner:validation-log-unsafe');
    }
    fs.writeFileSync(fd, `${JSON.stringify(receipt)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function isLifecyclePath(relativePath, change) {
  const normalized = normalizeRelative(relativePath);
  const changePrefix = `openspec/changes/${change}/`;
  return (
    normalized.startsWith('openspec/.specnav/')
    ||
    ['development/', 'verify/', 'codegraph/', 'operations/']
      .some((directory) => normalized.startsWith(`${changePrefix}${directory}`))
    || normalized.startsWith(`${changePrefix}verify-report.`)
    || normalized === `openspec/changes/${change}/tasks.md`
  );
}

function assertNoDirtyImplementation(projectRoot, change) {
  const changed = unique([
    ...git(projectRoot, ['diff', '--name-only', 'HEAD', '--']).split(/\r?\n/),
    ...git(projectRoot, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/)
  ]);
  const dirtyImplementation = changed.filter(
    (relative) => relative && !isLifecyclePath(relative, change)
  );
  if (dirtyImplementation.length > 0) {
    throw new Error(
      `evidence-runner:dirty-implementation-scope:${dirtyImplementation.join(',')}`
    );
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

function readTaskContexts(changeDir) {
  const tasksDir = path.join(changeDir, 'development', 'tasks');
  if (!fs.existsSync(tasksDir) || !fs.statSync(tasksDir).isDirectory()) {
    throw new Error('evidence-runner:missing-development-tasks');
  }

  const tasks = [];
  for (const taskId of fs.readdirSync(tasksDir).sort()) {
    const taskDir = path.join(tasksDir, taskId);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    const contextFile = path.join(taskDir, 'context.json');
    if (!fs.existsSync(contextFile)) {
      throw new Error(`evidence-runner:missing-context:${taskId}`);
    }
    let context;
    try {
      context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    } catch {
      throw new Error(`evidence-runner:invalid-context-json:${taskId}`);
    }
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
      throw new Error(`evidence-runner:invalid-context-schema:${taskId}`);
    }
    if (!TASK_ID_PATTERN.test(taskId)) {
      throw new Error(`evidence-runner:invalid-task-id:${taskId}`);
    }
    if (context.task_id !== taskId) {
      throw new Error(`evidence-runner:context-task-mismatch:${taskId}`);
    }
    if (
      !Array.isArray(context.test_paths)
      || context.test_paths.length === 0
      || context.test_paths.some((command) => (
        typeof command !== 'string' || command.trim() === ''
      ))
    ) {
      throw new Error(`evidence-runner:invalid-test-paths:${taskId}`);
    }
    const assertionIds = taskAssertionIds(context);
    if (assertionIds.length === 0) {
      throw new Error(`evidence-runner:no-assertions:${taskId}`);
    }
    tasks.push({
      task: taskId,
      commands: [...context.test_paths],
      assertion_ids: assertionIds
    });
  }
  if (tasks.length === 0) {
    throw new Error('evidence-runner:no-formal-task-contexts');
  }
  return tasks;
}

function currentHeadKey(entry) {
  return JSON.stringify([
    entry.reviewed_git_head,
    entry.reviewed_git_tree,
    entry.task,
    entry.command
  ]);
}

function isCompleteCurrentHeadReceipt(
  entry,
  reviewedGit,
  task,
  changeDir,
  receiptAuthority
) {
  const evidenceBinding = evidenceFileBinding(changeDir, entry.evidence_log);
  return (
    receiptAuthority.verify(entry)
    && entry.attestation === 'system-executed'
    && entry.reviewed_git_head === reviewedGit.head
    && entry.reviewed_git_tree === reviewedGit.tree
    && typeof entry.receipt_id === 'string'
    && entry.receipt_id.trim() !== ''
    && entry.task === task.task
    && task.commands.includes(entry.command)
    && Array.isArray(entry.assertion_ids)
    && JSON.stringify(entry.assertion_ids) === JSON.stringify(task.assertion_ids)
    && entry.status === 'pass'
    && entry.ok === true
    && entry.exit_status === 0
    && typeof entry.recorded_at === 'string'
    && !Number.isNaN(Date.parse(entry.recorded_at))
    && evidenceBinding !== null
    && entry.evidence_log_sha256 === evidenceBinding.sha256
    && entry.evidence_log_size === evidenceBinding.size
    && Object.prototype.hasOwnProperty.call(entry, 'exit_status')
  );
}

function receiptId(reviewedGit, task, command, assertionIds, evidenceLog) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([
      REFRESH_CURRENT_HEAD_MODE,
      reviewedGit.head,
      reviewedGit.tree,
      task,
      command,
      assertionIds,
      evidenceLog
    ]))
    .digest('hex');
  return `receipt-${digest}`;
}

function sameAssertionIds(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && JSON.stringify(left) === JSON.stringify(right);
}

function trustedReceiptRecord(
  record,
  changeDir,
  receiptAuthority
) {
  const entry = record.entry;
  const evidenceBinding = evidenceFileBinding(changeDir, entry.evidence_log);
  if (
    !receiptAuthority.verify(entry)
    || evidenceBinding === null
    || entry.evidence_log_sha256 !== evidenceBinding.sha256
    || entry.evidence_log_size !== evidenceBinding.size
  ) {
    return null;
  }
  return {
    ...record,
    entry
  };
}

function adjudicateCurrentHead(projectRoot, options = {}) {
  const changeState = lib.activeChangeState(
    projectRoot,
    options.change !== undefined ? { change: options.change } : {}
  );
  const change = changeState.change;
  if (!change) {
    return {
      ok: false,
      mode: ADJUDICATE_CURRENT_HEAD_MODE,
      change: null,
      blockers: changeState.blockers.length
        ? changeState.blockers
        : ['active-change'],
      adjudicated: 0,
      results: [],
      fallback_used: false
    };
  }

  try {
    const changeDir = lib.changeDir(projectRoot, change);
    const logFile = path.join(
      changeDir,
      'development',
      'validation-log.jsonl'
    );
    assertSafeExistingDirectoryTree(
      projectRoot,
      changeDir,
      'evidence-runner:change-directory-unsafe'
    );
    if (!fs.existsSync(logFile) || !fs.statSync(logFile).isFile()) {
      throw new Error(
        'evidence-runner:missing-development-artifact:validation-log.jsonl'
      );
    }
    assertNoDirtyImplementation(projectRoot, change);
    const reviewedGit = reviewedGitSnapshot(projectRoot);
    const receiptAuthority = options.receiptAuthority
      || resolveManagedValidationReceiptAuthority({
        projectRoot,
        changeDir
      });
    const parsed = parseLog(logFile);
    const trusted = parsed
      .map((record, index) => trustedReceiptRecord(
        { ...record, index },
        changeDir,
        receiptAuthority
      ))
      .filter(Boolean);
    const adjudicatedTargets = new Set(
      parsed
        .map(({ entry }) => entry)
        .filter((entry) => (
          entry.schema === 'specnav.validationAdjudication.v1'
          && String(entry.status || '').toLowerCase() === 'overturned'
          && typeof entry.target_evidence_log === 'string'
        ))
        .map((entry) => entry.target_evidence_log)
    );
    const currentPasses = trusted.filter(({ entry }) => (
      entry.status === 'pass'
      && entry.ok === true
      && entry.exit_status === 0
      && entry.reviewed_git_head === reviewedGit.head
      && entry.reviewed_git_tree === reviewedGit.tree
    ));
    const failures = trusted.filter(({ entry }) => (
      (
        entry.status !== 'pass'
        || entry.ok !== true
        || entry.exit_status !== 0
      )
      && !adjudicatedTargets.has(entry.evidence_log)
    ));
    const explicitTarget = options.targetEvidenceLog || null;
    const explicitSuccessor = options.supersedingEvidenceLog || null;
    const allowTaskLevel = options.allowTaskLevel === true;
    if (
      allowTaskLevel
      && (
        options.classification !== 'test_defect'
        || typeof options.approvalRef !== 'string'
        || options.approvalRef.trim() === ''
        || typeof options.reason !== 'string'
        || options.reason.trim() === ''
      )
    ) {
      throw new Error(
        'evidence-runner:task-level-adjudication-approval-required'
      );
    }

    const results = [];
    for (const failure of failures) {
      if (
        explicitTarget
        && failure.entry.evidence_log !== explicitTarget
      ) {
        continue;
      }
      const candidates = currentPasses.filter((pass) => (
        pass.index > failure.index
        && pass.entry.task === failure.entry.task
        && sameAssertionIds(
          pass.entry.assertion_ids,
          failure.entry.assertion_ids
        )
        && (
          allowTaskLevel
          || pass.entry.command === failure.entry.command
        )
        && (
          !explicitSuccessor
          || pass.entry.evidence_log === explicitSuccessor
        )
      ));
      const successor = candidates.at(-1);
      if (!successor) continue;
      const adjudication = {
        schema: 'specnav.validationAdjudication.v1',
        task: failure.entry.task,
        status: 'overturned',
        target_evidence_log: failure.entry.evidence_log,
        superseding_evidence_log: successor.entry.evidence_log,
        reason: allowTaskLevel
          ? options.reason.trim()
          : 'A later current-HEAD system-executed PASS for the same task, command, and assertion set supersedes this preserved failed attempt.',
        classification: allowTaskLevel
          ? options.classification
          : 'retest_pass',
        approval_ref: allowTaskLevel
          ? options.approvalRef.trim()
          : null,
        recorded_at: new Date().toISOString(),
        reviewed_git_head: reviewedGit.head,
        reviewed_git_tree: reviewedGit.tree,
        fallback_used: false
      };
      appendReceipt(logFile, adjudication);
      adjudicatedTargets.add(failure.entry.evidence_log);
      results.push(adjudication);
    }

    if (explicitTarget && results.length === 0) {
      throw new Error(
        'evidence-runner:adjudication-successor-not-found'
      );
    }
    return {
      ok: true,
      mode: ADJUDICATE_CURRENT_HEAD_MODE,
      change,
      reviewed_git_head: reviewedGit.head,
      reviewed_git_tree: reviewedGit.tree,
      adjudicated: results.length,
      results,
      blockers: [],
      fallback_used: false
    };
  } catch (error) {
    return {
      ok: false,
      mode: ADJUDICATE_CURRENT_HEAD_MODE,
      change,
      adjudicated: 0,
      results: [],
      blockers: [
        error instanceof Error ? error.message : String(error)
      ],
      fallback_used: false
    };
  }
}

function writeEvidenceLog(options) {
  const {
    evidenceDir,
    changeDir,
    task,
    command,
    run,
    usedEvidenceLogs
  } = options;
  let sequence = options.sequence;
  let logName;
  let evidenceLogRel;
  do {
    sequence += 1;
    logName = `${String(sequence).padStart(3, '0')}-${taskSlug({ task }, sequence - 1)}.log`;
    evidenceLogRel = path.posix.join('development', 'evidence', logName);
  } while (
    usedEvidenceLogs.has(evidenceLogRel)
    || fs.existsSync(path.join(changeDir, evidenceLogRel))
  );

  fs.writeFileSync(path.join(evidenceDir, logName), [
    `# command: ${command}`,
    `# exit_status: ${run.status}`,
    `# duration_ms: ${run.duration_ms}`,
    '',
    '## stdout',
    run.stdout || '(empty)',
    '',
    '## stderr',
    run.stderr || '(empty)',
    ''
  ].join('\n'), { flag: 'wx' });
  const binding = evidenceFileBinding(changeDir, evidenceLogRel);
  if (!binding) {
    throw new Error('evidence-runner:evidence-file-unsafe');
  }
  usedEvidenceLogs.add(evidenceLogRel);
  return {
    evidence_log: evidenceLogRel,
    evidence_log_sha256: binding.sha256,
    evidence_log_size: binding.size,
    sequence
  };
}

function shouldReplay(entry) {
  if (entry.attestation === 'system-executed') return false;
  if (entry.replayable === false) return false;
  if (typeof entry.command !== 'string' || !entry.command.trim()) return false;
  if (/<decision-required>|replace\s+(?:this\s+)?scaffold/i.test(entry.command)) return false;
  return true;
}

function nextEvidenceSequence(evidenceDir) {
  let max = 0;
  try {
    for (const name of fs.readdirSync(evidenceDir)) {
      const match = name.match(/^(\d+)-.+\.log$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
  } catch {
    return 0;
  }
  return max;
}

function refreshCurrentHead(projectRoot, options = {}) {
  const change = options.change;
  const maxCommands = options.maxCommands;
  if (
    typeof change !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change)
  ) {
    return {
      ok: false,
      mode: REFRESH_CURRENT_HEAD_MODE,
      change: null,
      blockers: ['evidence-runner:change-required'],
      results: [],
      fallback_used: false
    };
  }
  if (
    maxCommands !== null
    && maxCommands !== undefined
    && (!Number.isSafeInteger(maxCommands) || maxCommands < 1)
  ) {
    return {
      ok: false,
      mode: REFRESH_CURRENT_HEAD_MODE,
      change,
      blockers: ['evidence-runner:invalid-max-commands'],
      results: [],
      fallback_used: false
    };
  }

  const changeDir = lib.changeDir(projectRoot, change);
  const logFile = path.join(changeDir, 'development', 'validation-log.jsonl');
  try {
    if (!fs.existsSync(changeDir) || !fs.statSync(changeDir).isDirectory()) {
      throw new Error(`evidence-runner:missing-change:${change}`);
    }
    assertSafeExistingDirectoryTree(
      projectRoot,
      changeDir,
      'evidence-runner:change-directory-unsafe'
    );
    if (!fs.existsSync(logFile) || !fs.statSync(logFile).isFile()) {
      throw new Error('evidence-runner:missing-development-artifact:validation-log.jsonl');
    }

    const reviewedGit = reviewedGitSnapshot(projectRoot);
    assertNoDirtyImplementation(projectRoot, change);
    const tasks = readTaskContexts(changeDir);
    const tasksById = new Map(tasks.map((task) => [task.task, task]));
    const receiptAuthority = options.receiptAuthority
      || resolveManagedValidationReceiptAuthority({
        projectRoot,
        changeDir
      });
    const parsed = parseLog(logFile);
    const executedKeys = new Set(
      parsed
        .map(({ entry }) => entry)
        .filter((entry) => {
          const task = tasksById.get(entry.task);
          return task && isCompleteCurrentHeadReceipt(
            entry,
            reviewedGit,
            task,
            changeDir,
            receiptAuthority
          );
        })
        .map(currentHeadKey)
    );
    const usedEvidenceLogs = new Set(
      parsed
        .map(({ entry }) => entry.evidence_log)
        .filter((value) => typeof value === 'string' && value.trim() !== '')
    );
    const evidenceDir = path.join(changeDir, 'development', 'evidence');
    assertSafeDirectoryTree(
      changeDir,
      evidenceDir,
      'evidence-runner:evidence-directory-unsafe'
    );

    const pending = [];
    let skippedIdempotent = 0;
    for (const task of tasks) {
      for (const command of task.commands) {
        const key = currentHeadKey({
          reviewed_git_head: reviewedGit.head,
          reviewed_git_tree: reviewedGit.tree,
          task: task.task,
          command
        });
        if (executedKeys.has(key)) {
          skippedIdempotent += 1;
          continue;
        }
        pending.push({ task, command, key });
      }
    }

    const selected = maxCommands === null || maxCommands === undefined
      ? pending
      : pending.slice(0, maxCommands);
    const results = [];
    let sequence = nextEvidenceSequence(evidenceDir);
    for (const { task, command, key } of selected) {
        const run = lib.runCommand(command, {
          cwd: projectRoot,
          timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
        });
        const evidence = writeEvidenceLog({
          evidenceDir,
          changeDir,
          task: task.task,
          command,
          run,
          usedEvidenceLogs,
          sequence
        });
        sequence = evidence.sequence;
        const receipt = receiptAuthority.sign({
          schema: 'specnav.validationLog.v2',
          receipt_id: receiptId(
            reviewedGit,
            task.task,
            command,
            task.assertion_ids,
            evidence.evidence_log
          ),
          task: task.task,
          command,
          assertion_ids: [...task.assertion_ids],
          status: run.ok ? 'pass' : 'fail',
          ok: run.ok,
          exit_status: run.status,
          attestation: 'system-executed',
          recorded_by: RUNNER_ID,
          recorded_at: new Date().toISOString(),
          reviewed_git_head: reviewedGit.head,
          reviewed_git_tree: reviewedGit.tree,
          evidence_log: evidence.evidence_log,
          evidence_log_sha256: evidence.evidence_log_sha256,
          evidence_log_size: evidence.evidence_log_size,
          stdout_tail: headTail(run.stdout),
          stderr_tail: headTail(run.stderr),
          overturned: false
        });
        try {
          appendReceipt(logFile, receipt);
        } catch (error) {
          fs.rmSync(path.join(changeDir, evidence.evidence_log), { force: true });
          throw error;
        }
        executedKeys.add(key);
        results.push(receipt);
    }

    const failed = results.filter((item) => !item.ok);
    const remaining = pending.length - selected.length;
    const blockers = [];
    if (failed.length) blockers.push('validation-log:executed-evidence-failed');
    if (remaining > 0) blockers.push('evidence-runner:refresh-incomplete');
    return {
      ok: blockers.length === 0,
      mode: REFRESH_CURRENT_HEAD_MODE,
      change,
      reviewed_git_head: reviewedGit.head,
      reviewed_git_tree: reviewedGit.tree,
      task_count: tasks.length,
      blockers,
      replayed: results.length,
      skipped_idempotent: skippedIdempotent,
      failed: failed.length,
      pending_before: pending.length,
      remaining,
      batch_limited: maxCommands !== null && maxCommands !== undefined,
      results,
      fallback_used: false
    };
  } catch (error) {
    return {
      ok: false,
      mode: REFRESH_CURRENT_HEAD_MODE,
      change,
      blockers: [error instanceof Error ? error.message : String(error)],
      results: [],
      fallback_used: false
    };
  }
}

function replayValidationLog(projectRoot, options = {}) {
  const changeState = lib.activeChangeState(projectRoot, options.change !== undefined ? { change: options.change } : {});
  const change = changeState.change;
  if (!change) {
    return { ok: false, change: null, blockers: changeState.blockers.length ? changeState.blockers : ['active-change'], results: [] };
  }
  const changeDir = lib.changeDir(projectRoot, change);
  const logFile = path.join(changeDir, 'development', 'validation-log.jsonl');
  if (!fs.existsSync(logFile)) {
    return { ok: false, change, blockers: ['missing-development-artifact:validation-log.jsonl'], results: [] };
  }

  const evidenceDir = path.join(changeDir, 'development', 'evidence');
  try {
    assertSafeExistingDirectoryTree(
      projectRoot,
      changeDir,
      'evidence-runner:change-directory-unsafe'
    );
    assertSafeDirectoryTree(
      changeDir,
      evidenceDir,
      'evidence-runner:evidence-directory-unsafe'
    );
  } catch (error) {
    return {
      ok: false,
      change,
      blockers: [error instanceof Error ? error.message : String(error)],
      results: []
    };
  }

  let receiptAuthority;
  let parsed;
  try {
    receiptAuthority = options.receiptAuthority
      || resolveManagedValidationReceiptAuthority({
        projectRoot,
        changeDir
      });
    parsed = parseLog(logFile);
  } catch (error) {
    return {
      ok: false,
      change,
      blockers: [error instanceof Error ? error.message : String(error)],
      results: []
    };
  }
  const entryKey = (entry) => `${entry.task || entry.task_id || ''} ${entry.command}`;
  // Idempotency: a task+command pair that already carries a system-executed
  // receipt is settled evidence; do not re-replay it on subsequent runs.
  const executedKeys = new Set(
    parsed
      .filter(({ entry }) => (
        receiptAuthority.verify(entry)
        && entry.status === 'pass'
        && entry.ok === true
        && entry.exit_status === 0
        && evidenceFileBinding(changeDir, entry.evidence_log)?.sha256
          === entry.evidence_log_sha256
        && evidenceFileBinding(changeDir, entry.evidence_log)?.size
          === entry.evidence_log_size
      ))
      .map(({ entry }) => entryKey(entry))
  );
  const seen = new Set();
  const results = [];
  let sequence = nextEvidenceSequence(evidenceDir);

  for (const { entry } of parsed) {
    if (!shouldReplay({
      ...entry,
      attestation: entry.attestation === 'system-executed'
        ? 'untrusted-self-report'
        : entry.attestation
    })) continue;
    const key = entryKey(entry);
    if (seen.has(key) || executedKeys.has(key)) continue;
    seen.add(key);
    sequence += 1;

    const run = lib.runCommand(entry.command, {
      cwd: projectRoot,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
    });
    const slug = taskSlug(entry, sequence - 1);
    const logName = `${String(sequence).padStart(3, '0')}-${slug}.log`;
    const evidenceLogRel = path.posix.join('development', 'evidence', logName);
    fs.writeFileSync(path.join(evidenceDir, logName), [
      `# command: ${entry.command}`,
      `# exit_status: ${run.status}`,
      `# duration_ms: ${run.duration_ms}`,
      '',
      '## stdout',
      run.stdout || '(empty)',
      '',
      '## stderr',
      run.stderr || '(empty)',
      ''
    ].join('\n'));
    const evidenceBinding = evidenceFileBinding(changeDir, evidenceLogRel);
    if (!evidenceBinding) {
      throw new Error('evidence-runner:evidence-file-unsafe');
    }

    const claimedPass = entry.ok === true || ['pass', 'passed'].includes(String(entry.status || '').toLowerCase());
    const receipt = receiptAuthority.sign({
      schema: 'specnav.validationLog.v2',
      receipt_id: receiptId(
        { head: 'legacy', tree: 'legacy' },
        entry.task || entry.task_id || null,
        entry.command,
        [],
        evidenceLogRel
      ),
      task: entry.task || entry.task_id || null,
      command: entry.command,
      status: run.ok ? 'pass' : 'fail',
      ok: run.ok,
      exit_status: run.status,
      attestation: 'system-executed',
      recorded_by: RUNNER_ID,
      recorded_at: new Date().toISOString(),
      evidence_log: evidenceLogRel,
      evidence_log_sha256: evidenceBinding.sha256,
      evidence_log_size: evidenceBinding.size,
      stdout_tail: headTail(run.stdout),
      stderr_tail: headTail(run.stderr),
      overturned: claimedPass && !run.ok
    });
    appendReceipt(logFile, receipt);
    results.push(receipt);
  }

  const failed = results.filter((item) => !item.ok);
  const overturned = results.filter((item) => item.overturned);
  lib.event(projectRoot, 'evidence-runner.completed', {
    active_change: change,
    replayed: results.length,
    failed: failed.length,
    overturned: overturned.map((item) => ({ task: item.task, command: item.command }))
  });

  return {
    ok: failed.length === 0,
    change,
    blockers: failed.length ? ['validation-log:executed-evidence-failed'] : [],
    replayed: results.length,
    failed: failed.length,
    overturned: overturned.length,
    results
  };
}

function runEvidence(projectRoot, options = {}) {
  if (options.mode === REFRESH_CURRENT_HEAD_MODE) {
    return refreshCurrentHead(projectRoot, options);
  }
  if (options.mode === ADJUDICATE_CURRENT_HEAD_MODE) {
    return adjudicateCurrentHead(projectRoot, options);
  }
  {
    return {
      ok: false,
      mode: options.mode || null,
      change: options.change || null,
      blockers: [`evidence-runner:unsupported-mode:${String(options.mode || null)}`],
      results: [],
      fallback_used: false
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  const root = lib.projectRoot();
  const mode = args[0] && !args[0].startsWith('--') ? args[0] : null;
  const change = argValue(args, '--change', null);
  const result = runEvidence(root, {
    mode,
    change,
    timeoutMs: Number(argValue(args, '--timeout-ms', DEFAULT_TIMEOUT_MS)),
    maxCommands: args.includes('--max-commands')
      ? Number(argValue(args, '--max-commands', Number.NaN))
      : null,
    targetEvidenceLog: argValue(args, '--target-evidence-log', null),
    supersedingEvidenceLog: argValue(
      args,
      '--superseding-evidence-log',
      null
    ),
    classification: argValue(args, '--classification', null),
    approvalRef: argValue(args, '--approval-ref', null),
    reason: argValue(args, '--reason', null),
    allowTaskLevel: args.includes('--allow-task-level')
  });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`evidence-runner: mode=${result.mode || 'none'} change=${result.change || 'none'} replayed=${result.replayed || 0} failed=${result.failed || 0} overturned=${result.overturned || 0}\n`);
    for (const blocker of result.blockers) process.stdout.write(`blocker: ${blocker}\n`);
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  ADJUDICATE_CURRENT_HEAD_MODE,
  REFRESH_CURRENT_HEAD_MODE,
  RUNNER_ID,
  adjudicateCurrentHead,
  nextEvidenceSequence,
  refreshCurrentHead,
  replayValidationLog,
  runEvidence,
  taskAssertionIds
};
