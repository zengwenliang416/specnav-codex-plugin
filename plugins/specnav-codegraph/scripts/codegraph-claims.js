#!/usr/bin/env node
'use strict';

const path = require('path');
const store = require('../core/codegraph-evidence-store');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function validateClaims(claimsMap, evidenceIndex) {
  const blockers = [];
  const verified = [];
  const unverified = [];
  if (!claimsMap || typeof claimsMap !== 'object') return { ok: false, blockers: ['codegraph:missing-claims-map'] };
  if (!Array.isArray(claimsMap.claims)) blockers.push('codegraph:invalid-claims-map');
  const byClaim = evidenceIndex && evidenceIndex.by_claim || {};
  for (const claim of claimsMap.claims || []) {
    if (!claim || typeof claim !== 'object' || !claim.id) {
      blockers.push('codegraph:invalid-claim');
      continue;
    }
    const indexed = byClaim[claim.id];
    if (!indexed || ['missing', 'stale', 'disabled'].includes(indexed.status)) {
      blockers.push(`codegraph:claim-unverified:${claim.id}`);
      unverified.push(claim.id);
    } else {
      verified.push(claim.id);
    }
  }
  return { ok: blockers.length === 0, blockers, verified, unverified };
}

function main(argv = process.argv.slice(2)) {
  if (hasFlag(argv, '--help')) {
    process.stdout.write('Usage: codegraph-claims.js [--project <dir>] [--change <id>] [--claims <file>] [--json]\n');
    return 0;
  }
  const projectRoot = path.resolve(argValue(argv, '--project', process.env.PROJECT_DIR || process.cwd()));
  const change = argValue(argv, '--change', process.env.SPECNAV_CHANGE || store.activeChange(projectRoot));
  if (!change) {
    process.stdout.write(`${JSON.stringify({ ok: false, blockers: ['active-change'] }, null, 2)}\n`);
    return 2;
  }
  const dir = store.defaultChangeCodegraphDir(projectRoot, change);
  const claimsFile = path.resolve(argValue(argv, '--claims', path.join(dir, 'claims-map.json')));
  const rawFile = path.join(dir, 'evidence.jsonl');
  const indexFile = path.join(dir, 'evidence-index.json');
  const claimsMap = store.readJson(claimsFile, null);
  const evidenceIndex = store.loadOrBuildIndex(rawFile, indexFile, {
    activeChange: change,
    sourceRaw: `openspec/changes/${change}/codegraph/evidence.jsonl`
  });
  const validation = validateClaims(claimsMap, evidenceIndex);
  const result = {
    schema: 'specnav.codegraph.claims_report.v1',
    generated_at: new Date().toISOString(),
    ok: validation.ok,
    active_change: change,
    claims_file: claimsFile,
    evidence_index_file: indexFile,
    claims_count: claimsMap && Array.isArray(claimsMap.claims) ? claimsMap.claims.length : 0,
    verified_claims: validation.verified || [],
    unverified_claims: validation.unverified || [],
    blockers: validation.blockers
  };
  store.writeJson(path.join(dir, 'claims-report.json'), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = {
  main,
  validateClaims
};
