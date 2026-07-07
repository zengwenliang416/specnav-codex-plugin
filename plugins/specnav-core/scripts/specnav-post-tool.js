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
  if (fs.existsSync(report)) {
    try {
      fs.writeFileSync(path.join(dir, 'verify-report.stale'), `${new Date().toISOString()}\n`);
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
