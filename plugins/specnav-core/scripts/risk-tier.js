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

function classify(paths) {
  const normalized = paths.map((p) => p.split(path.sep).join('/'));
  const hits = [];
  for (const p of normalized) {
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(p)) hits.push(p);
    }
  }
  if (hits.length) {
    return { tier: 'high-risk', source: 'path-trigger', triggers: Array.from(new Set(hits)) };
  }
  if (normalized.some((p) => /^src\/|^app\/|^lib\/|^packages\//.test(p))) {
    return { tier: 'standard', source: 'path-heuristic', triggers: [] };
  }
  return { tier: 'lite', source: 'path-heuristic', triggers: [] };
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
