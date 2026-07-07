#!/usr/bin/env node
'use strict';

// PreCompact hook: inject a compact workflow-state summary so the post-
// compaction context keeps the load-bearing SpecNav state. Best-effort —
// failures never block compaction.

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');

function drainStdin() {
  try { fs.readFileSync(0, 'utf8'); } catch {}
}

function main() {
  drainStdin();
  try {
    const root = lib.projectRoot();
    if (!fs.existsSync(lib.openspecDir(root))) process.exit(0);
    const state = lib.readJson(path.join(lib.specnavDir(root), 'workflow-state.json'), null);
    const change = (state && state.active_change) || lib.activeChange(root);
    const parts = [
      `SpecNav state: active change ${change || 'none'}`,
      state ? `status ${state.status}` : null,
      state && Array.isArray(state.blockers) && state.blockers.length
        ? `blockers: ${state.blockers.slice(0, 8).join(', ')}`
        : null
    ];
    const changeDir = change ? lib.changeDir(root, change) : null;
    if (changeDir) {
      const acceptance = lib.readAcceptanceAssertions(changeDir);
      if (acceptance.present) {
        const failing = acceptance.assertions.filter((assertion) => assertion.status !== 'passing').length;
        parts.push(`acceptance assertions: ${failing}/${acceptance.assertions.length} failing`);
      }
      if (lib.fileExists(path.join(changeDir, 'verify-report.stale'))) parts.push('verify report is STALE');
    }
    parts.push('Authoritative state lives in openspec/.specnav/workflow-state.json; re-read it rather than relying on pre-compaction memory.');
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreCompact',
        additionalContext: parts.filter(Boolean).join('. ')
      }
    })}\n`);
  } catch {
    // Never block compaction over bookkeeping.
  }
  process.exit(0);
}

main();
