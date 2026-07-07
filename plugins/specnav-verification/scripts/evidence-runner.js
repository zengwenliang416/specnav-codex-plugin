#!/usr/bin/env node
'use strict';

// Replays validation-log commands and records system-executed receipts.
// Self-reported entries are claims; entries written here are facts: the
// runner executes the command itself and attests the observed exit status.
// Contract scripts treat only these entries as executed evidence.

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

const RUNNER_ID = 'specnav-evidence-runner';
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
  const text = lib.readText(file);
  if (!text) return entries;
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        entries.push({ entry, line: index + 1 });
      }
    } catch {
      // Invalid lines are the contract's problem to report, not ours.
    }
  });
  return entries;
}

function shouldReplay(entry) {
  if (entry.attestation === 'system-executed') return false;
  if (entry.replayable === false) return false;
  if (typeof entry.command !== 'string' || !entry.command.trim()) return false;
  if (/<decision-required>|replace\s+(?:this\s+)?scaffold/i.test(entry.command)) return false;
  return true;
}

function runEvidence(projectRoot, options = {}) {
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
  lib.ensureDir(evidenceDir);

  const parsed = parseLog(logFile);
  const entryKey = (entry) => `${entry.task || entry.task_id || ''} ${entry.command}`;
  // Idempotency: a task+command pair that already carries a system-executed
  // receipt is settled evidence; do not re-replay it on subsequent runs.
  const executedKeys = new Set(
    parsed
      .filter(({ entry }) => entry.attestation === 'system-executed')
      .map(({ entry }) => entryKey(entry))
  );
  const seen = new Set();
  const results = [];
  let sequence = 0;

  for (const { entry } of parsed) {
    if (!shouldReplay(entry)) continue;
    const key = entryKey(entry);
    if (seen.has(key) || executedKeys.has(key)) continue;
    seen.add(key);
    sequence += 1;

    const run = lib.runCommand(entry.command, {
      cwd: projectRoot,
      timeoutMs: options.timeoutMs || 300000
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

    const claimedPass = entry.ok === true || ['pass', 'passed'].includes(String(entry.status || '').toLowerCase());
    const receipt = {
      schema: 'specnav.validationLog.v2',
      task: entry.task || entry.task_id || null,
      command: entry.command,
      status: run.ok ? 'pass' : 'fail',
      ok: run.ok,
      exit_status: run.status,
      attestation: 'system-executed',
      recorded_by: RUNNER_ID,
      recorded_at: new Date().toISOString(),
      evidence_log: evidenceLogRel,
      stdout_tail: headTail(run.stdout),
      stderr_tail: headTail(run.stderr),
      overturned: claimedPass && !run.ok
    };
    fs.appendFileSync(logFile, `${JSON.stringify(receipt)}\n`);
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

function main() {
  const args = process.argv.slice(2);
  const root = lib.projectRoot();
  const change = argValue(args, '--change', null);
  const result = runEvidence(root, change ? { change } : {});
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`evidence-runner: change=${result.change || 'none'} replayed=${result.replayed || 0} failed=${result.failed || 0} overturned=${result.overturned || 0}\n`);
    for (const blocker of result.blockers) process.stdout.write(`blocker: ${blocker}\n`);
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { runEvidence, RUNNER_ID };
