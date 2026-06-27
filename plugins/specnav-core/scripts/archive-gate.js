#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');

function gate(root = lib.projectRoot()) {
  const change = lib.activeChange(root);
  const dir = lib.changeDir(root, change);
  const blockers = [];
  if (!dir || !fs.existsSync(dir)) blockers.push('active-change');
  const verify = lib.readJson(path.join(dir || '', 'verify-report.json'), null);
  if (!verify || verify.status !== 'green') blockers.push('verify');
  if (lib.fileExists(path.join(dir || '', 'verify-report.stale'))) blockers.push('fresh-verify');
  const risk = lib.readJson(path.join(dir || '', 'risk-tier.json'), { tier: 'standard' });
  if (risk.tier === 'high-risk' && !lib.fileExists(path.join(dir || '', 'signoff.yaml'))) blockers.push('human-signoff');
  return {
    ok: blockers.length === 0,
    active_change: change,
    risk_tier: risk.tier,
    blockers
  };
}

function main() {
  const result = gate();
  if (result.ok) {
    console.log(`SpecNav archive gate passed for ${result.active_change}.`);
  } else {
    console.error(`SpecNav archive gate blocked for ${result.active_change || 'none'}: ${result.blockers.join(', ')}`);
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { gate };
