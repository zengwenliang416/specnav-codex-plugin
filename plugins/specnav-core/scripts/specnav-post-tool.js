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
    fs.writeFileSync(path.join(dir, 'verify-report.stale'), `${new Date().toISOString()}\n`);
    lib.event(root, 'verify.stale', { active_change: change });
  }
  drainStdin();
  process.exit(0);
}

main();
