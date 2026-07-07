#!/usr/bin/env node
'use strict';

// Stop hook: before Claude ends its turn, check that production edits made
// during the session have been accounted for in the development ledger.
// Edits without any ledger progress means work is being reported as done
// without recorded status — block once and ask for bookkeeping.
//
// Loop safety: the hook payload sets stop_hook_active=true when Claude is
// already continuing from a stop hook; we never block twice in a row.

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');

function readStdinJson() {
  try {
    const input = fs.readFileSync(0, 'utf8').trim();
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function main() {
  const payload = readStdinJson();
  if (payload.stop_hook_active === true) process.exit(0);

  const root = lib.projectRoot();
  if (!fs.existsSync(lib.openspecDir(root))) process.exit(0);
  const change = lib.activeChange(root);
  const changeDir = lib.changeDir(root, change);
  if (!changeDir) process.exit(0);

  // Signal that production work happened this session: post-tool marked the
  // verify report stale. If there is no stale marker there were no tracked
  // production edits, so there is nothing to account for.
  const staleAt = mtimeOf(path.join(changeDir, 'verify-report.stale'));
  if (staleAt === null) process.exit(0);

  const ledgerFile = path.join(changeDir, 'development', 'task-ledger.jsonl');
  const logFile = path.join(changeDir, 'development', 'validation-log.jsonl');
  const ledgerAt = mtimeOf(ledgerFile);
  const logAt = mtimeOf(logFile);
  const accounted = (ledgerAt !== null && ledgerAt >= staleAt) || (logAt !== null && logAt >= staleAt);
  if (accounted) process.exit(0);

  lib.event(root, 'stop.unaccounted-edits', { active_change: change });
  process.stdout.write(`${JSON.stringify({
    decision: 'block',
    reason: `Production files for change ${change} were edited this session but neither development/task-ledger.jsonl nor development/validation-log.jsonl has a newer entry. Record the task status and validation evidence before ending the turn (or state explicitly why no ledger entry applies).`
  })}\n`);
  process.exit(0);
}

main();
