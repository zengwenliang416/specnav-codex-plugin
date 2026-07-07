#!/usr/bin/env node
'use strict';

const path = require('path');
const lib = require('./specnav-lib');

const HIGH_RISK_PATTERNS = [
  /(^|\/)(auth|permission|permissions|billing|payment|crypto|security)(\/|$)/i,
  /(^|\/)(migrations?|schema|schemas)(\/|$)/i,
  /(^|\/)(api|routes?|controllers?)(\/|$)/i,
  /(^|\/)(\.github|ci|deploy|infra|k8s|specnav)(\/|$)/i,
  /package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|package\.json$/i
];

// Lane routing: the tier decides which lifecycle lane the change takes.
// - light: docs/config-only low-risk changes — prototype may be recorded as
//   not_required, quality review folds into spec review, verification
//   requires only static + unit domains.
// - standard / full: the complete lifecycle. full additionally requires
//   human signoff at release (existing high-risk behavior).
// Anti-gaming: a light-lane change whose cumulative production diff exceeds
// escalation_threshold files must re-classify (lane-escalation-required).
const LANE_BY_TIER = { 'high-risk': 'full', standard: 'standard', lite: 'light' };
const DEFAULT_ESCALATION_THRESHOLD = 10;

function classify(paths) {
  const normalized = paths.map((p) => p.split(path.sep).join('/'));
  const hits = [];
  for (const p of normalized) {
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(p)) hits.push(p);
    }
  }
  let result;
  if (hits.length) {
    result = { tier: 'high-risk', source: 'path-trigger', triggers: Array.from(new Set(hits)) };
  } else if (normalized.some((p) => /^src\/|^app\/|^lib\/|^packages\//.test(p))) {
    result = { tier: 'standard', source: 'path-heuristic', triggers: [] };
  } else {
    result = { tier: 'lite', source: 'path-heuristic', triggers: [] };
  }
  result.lane = LANE_BY_TIER[result.tier];
  result.escalation_threshold = DEFAULT_ESCALATION_THRESHOLD;
  result.reason = result.triggers.length
    ? `high-risk path triggers: ${result.triggers.join(', ')}`
    : `no high-risk triggers; classified by path heuristic over ${normalized.length} path(s)`;
  return result;
}

function pathsFromDesign(changeDir) {
  const design = lib.readText(path.join(changeDir, 'design.md'));
  return lib.parseScope(design);
}

function main() {
  const args = process.argv.slice(2);
  const writeIndex = args.indexOf('--write');
  const pathsIndex = args.indexOf('--paths');
  let targetDir = null;
  let paths = [];
  if (writeIndex >= 0) {
    targetDir = path.resolve(args[writeIndex + 1]);
    paths = pathsFromDesign(targetDir);
  }
  if (pathsIndex >= 0) {
    paths = args.slice(pathsIndex + 1);
  }
  const result = classify(paths);
  result.checked_paths = paths;
  result.generated_at = new Date().toISOString();
  if (targetDir) {
    lib.writeJson(path.join(targetDir, 'risk-tier.json'), result);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { classify };
