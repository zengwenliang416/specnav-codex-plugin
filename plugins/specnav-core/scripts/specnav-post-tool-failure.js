#!/usr/bin/env node
'use strict';

// PostToolUseFailure hook: classify tool failures into the same blocker
// classes the verification stage uses, and append them to the change's
// blocker-classification ledger. Non-blocking by design — a bookkeeping
// failure must never compound a tool failure.

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

function classify(errorText) {
  const text = String(errorText || '').toLowerCase();
  if (/permission denied|eacces|unauthorized|forbidden|401|403|auth/.test(text)) return 'env-auth';
  if (/command not found|enoent|no such file|not installed|econnrefused|etimedout|network|dns/.test(text)) return 'env-runtime';
  if (/specnav gate denied|\[scope\]|\[frozen-|\[missing-|\[invalid-scope\]|blocker/.test(text)) return 'contract-regression';
  if (/test.*fail|assert|expect.*received|exit code 1/.test(text)) return 'insufficient-evidence';
  return 'env-runtime';
}

function main() {
  const payload = readStdinJson();
  try {
    const root = lib.projectRoot();
    if (!fs.existsSync(lib.openspecDir(root))) process.exit(0);
    const change = lib.activeChange(root);
    const changeDir = lib.changeDir(root, change);
    if (!changeDir) process.exit(0);

    const errorText = typeof payload.tool_error === 'string'
      ? payload.tool_error
      : JSON.stringify(payload.tool_error || payload.error || '');
    const entry = {
      schema: 'specnav.blockerClassification.v1',
      recorded_at: new Date().toISOString(),
      source: 'post-tool-failure-hook',
      tool: payload.tool_name || 'unknown',
      blocker_class: classify(errorText),
      error_tail: errorText.slice(-500)
    };
    const file = path.join(changeDir, 'verify', 'blocker-classification.jsonl');
    lib.ensureDir(path.dirname(file));
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
    lib.event(root, 'tool.failure-classified', {
      active_change: change,
      tool: entry.tool,
      blocker_class: entry.blocker_class
    });
  } catch {
    // Never compound a tool failure with a bookkeeping failure.
  }
  process.exit(0);
}

main();
