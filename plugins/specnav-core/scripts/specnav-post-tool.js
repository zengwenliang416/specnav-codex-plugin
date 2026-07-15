#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');

function drainStdin() {
  try { fs.readFileSync(0, 'utf8'); } catch {}
}

function main() {
  const root = lib.projectRoot();
  const change = lib.activeChange(root);
  const dir = lib.changeDir(root, change);
  if (!dir) process.exit(0);
  const report = path.join(dir, 'verify-report.json');
  const staleMarker = path.join(dir, 'verify-report.stale');
  if (fs.existsSync(report)) {
    // Idempotent: once the report is marked stale, later edits in the same
    // implementation burst add no information — skip the write and the event
    // (observed 1.4k duplicate verify.stale events per project).
    if (fs.existsSync(staleMarker)) {
      drainStdin();
      process.exit(0);
    }
    try {
      fs.writeFileSync(staleMarker, `${new Date().toISOString()}\n`);
      lib.event(root, 'verify.stale', { active_change: change });
    } catch (error) {
      // Bookkeeping failure must not outrank the edit itself: warn loudly,
      // record for doctor, and let the session continue. Archive stays safe
      // because archive-gate independently requires a fresh green verify.
      try {
        lib.event(root, 'verify.stale-marker-failed', { active_change: change, error: error.message });
      } catch {}
      drainStdin();
      process.stdout.write(`${JSON.stringify({
        systemMessage: `SpecNav could not mark verify-report as stale for change ${change} (${error.message}). The verify report may be outdated; run $specnav-doctor and re-run verification before release.`
      })}\n`);
      process.exit(0);
    }
  }
  drainStdin();
  process.exit(0);
}

main();
