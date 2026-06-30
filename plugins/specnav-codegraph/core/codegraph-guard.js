#!/usr/bin/env node
'use strict';

const path = require('path');
const decision = require('./codegraph-decision-engine');
const driftDetector = require('./codegraph-drift-detector');
const statusManager = require('./codegraph-status-manager');
const store = require('./codegraph-evidence-store');

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function validateClaims(dir, evidenceIndex, options = {}) {
  const claimsFile = path.join(dir, 'claims-map.json');
  const claimsMap = store.readJson(claimsFile, null);
  const blockers = [];
  const warnings = [];
  const unverified = [];
  const verified = [];

  if (!claimsMap) {
    if (options.required) blockers.push('codegraph:missing-claims-map');
    return {
      schema: 'specnav.codegraph.claims_report.v1',
      generated_at: new Date().toISOString(),
      active_change: options.change || null,
      claims_file: `openspec/changes/${options.change}/codegraph/claims-map.json`,
      evidence_index: `openspec/changes/${options.change}/codegraph/evidence-index.json`,
      claims_count: 0,
      verified_claims: verified,
      unverified_claims: unverified,
      blockers,
      warnings
    };
  }

  if (claimsMap.schema !== 'specnav.codegraph.claims.v1') blockers.push('codegraph:invalid-claims-map-schema');
  if (!Array.isArray(claimsMap.claims)) blockers.push('codegraph:invalid-claims-map');

  const byClaim = evidenceIndex && evidenceIndex.by_claim || {};
  for (const claim of claimsMap.claims || []) {
    if (!claim || typeof claim !== 'object' || typeof claim.id !== 'string' || claim.id.trim() === '') {
      blockers.push('codegraph:invalid-claim');
      continue;
    }
    const indexed = byClaim[claim.id];
    if (!indexed || ['missing', 'stale', 'disabled'].includes(indexed.status)) {
      const blocker = `codegraph:claim-unverified:${claim.id}`;
      unverified.push(claim.id);
      if (options.required) blockers.push(blocker);
      else warnings.push(blocker);
    } else {
      verified.push(claim.id);
    }
  }

  return {
    schema: 'specnav.codegraph.claims_report.v1',
    generated_at: new Date().toISOString(),
    active_change: options.change || null,
    claims_file: `openspec/changes/${options.change}/codegraph/claims-map.json`,
    evidence_index: `openspec/changes/${options.change}/codegraph/evidence-index.json`,
    claims_count: Array.isArray(claimsMap.claims) ? claimsMap.claims.length : 0,
    verified_claims: unique(verified),
    unverified_claims: unique(unverified),
    blockers: unique(blockers),
    warnings: unique(warnings)
  };
}

function writeGuardArtifacts(projectRoot, change, payload) {
  const paths = store.artifactPaths(projectRoot, change);
  const relative = store.relativeArtifactPaths(change);
  store.writeJson(paths.status, payload.status);
  store.writeJson(paths.decision, payload.decision);
  store.writeJson(paths.guardReport, payload.guardReport);
  store.writeJson(paths.driftReport, payload.drift);
  store.writeJson(paths.claimsReport, payload.claimsReport);
  return relative;
}

function guard(options = {}) {
  const status = statusManager.status({
    projectRoot: options.projectRoot,
    stage: options.stage || 'development',
    change: options.change || null
  });
  const change = options.change || status.active_change || store.activeChange(status.project_root);
  let evidenceIndex = null;
  if (change) {
    const dir = store.defaultChangeCodegraphDir(status.project_root, change);
    evidenceIndex = store.loadOrBuildIndex(
      path.join(dir, 'evidence.jsonl'),
      path.join(dir, 'evidence-index.json'),
      {
        activeChange: change,
        sourceRaw: `openspec/changes/${change}/codegraph/evidence.jsonl`
      }
    );
  }
  const resolved = decision.resolve(options.stage || 'development', status.policy, status, evidenceIndex, null, {
    requireEvidence: options.requireEvidence === true
  });
  const changeDir = change ? store.defaultChangeCodegraphDir(status.project_root, change) : null;
  const claimsReport = changeDir ? validateClaims(changeDir, evidenceIndex, {
    change,
    required: resolved.required_for_stage === true && options.requireEvidence === true
  }) : null;
  const drift = driftDetector.detectDrift(status, evidenceIndex);
  const driftBlockers = Array.isArray(drift.blockers) ? drift.blockers : [];
  const blockers = unique([
    ...(resolved.blockers || []),
    ...(resolved.required_for_stage === true ? driftBlockers : []),
    ...(claimsReport && Array.isArray(claimsReport.blockers) ? claimsReport.blockers : [])
  ]);
  const warnings = unique([
    ...(resolved.warnings || []),
    ...(resolved.required_for_stage === true ? [] : driftBlockers),
    ...(claimsReport && Array.isArray(claimsReport.warnings) ? claimsReport.warnings : [])
  ]);
  const guardReport = {
    schema: 'specnav.codegraph.guard_report.v1',
    generated_at: new Date().toISOString(),
    active_change: change || null,
    stage: options.stage || 'development',
    ok: blockers.length === 0,
    status: {
      policy: status.policy,
      execution_surface: status.execution_surface,
      cli: status.cli,
      mcp: status.mcp,
      index: status.index
    },
    decision: resolved,
    evidence_index: evidenceIndex,
    claims_report: claimsReport,
    drift,
    blockers,
    warnings
  };
  let artifacts = null;
  if (change && options.writeArtifacts === true) {
    artifacts = writeGuardArtifacts(status.project_root, change, {
      status,
      decision: resolved,
      drift,
      claimsReport,
      guardReport
    });
  }
  return {
    ok: blockers.length === 0,
    status,
    evidence_index: evidenceIndex,
    claims_report: claimsReport,
    drift,
    decision: resolved,
    guard_report: guardReport,
    artifacts,
    blockers,
    warnings
  };
}

module.exports = {
  guard
};
