#!/usr/bin/env node
'use strict';

const STAGES = new Set(['requirements', 'prototype', 'development', 'verification', 'operations']);
const MODES = new Set(['disabled', 'observe', 'advisory', 'required']);

const PROFILE_DEFAULTS = {
  bootstrap: {
    mode: 'observe',
    required: []
  },
  active_dev: {
    mode: 'advisory',
    required: []
  },
  production: {
    mode: 'required',
    required: ['development', 'verification', 'operations']
  },
  custom: {
    mode: 'advisory',
    required: []
  }
};

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function stageFlag(stage) {
  return `${stage}_required`;
}

function cleanStage(stage) {
  return STAGES.has(stage) ? stage : 'development';
}

function defaultProfile(status = {}) {
  return status && status.index && status.index.initialized ? 'active_dev' : 'bootstrap';
}

function normalizePolicy(stage, inputPolicy = {}, status = {}) {
  const clean = cleanStage(stage);
  const requestedProfile = inputPolicy.profile || inputPolicy.codegraph_enforcement_profile || defaultProfile(status);
  const profile = Object.prototype.hasOwnProperty.call(PROFILE_DEFAULTS, requestedProfile)
    ? requestedProfile
    : 'custom';
  const base = PROFILE_DEFAULTS[profile];
  const enabled = inputPolicy.enabled !== false && inputPolicy.mode !== 'disabled';
  const mode = enabled
    ? (MODES.has(inputPolicy.mode) ? inputPolicy.mode : base.mode)
    : 'disabled';
  const explicitStageFlag = Object.prototype.hasOwnProperty.call(inputPolicy, stageFlag(clean));
  const explicitRequiredForStage = Object.prototype.hasOwnProperty.call(inputPolicy, 'required_for_stage');
  const requiredForStage = mode === 'disabled'
    ? false
    : explicitStageFlag
      ? inputPolicy[stageFlag(clean)] === true
      : explicitRequiredForStage
        ? inputPolicy.required_for_stage === true
        : base.required.includes(clean);

  return {
    enabled,
    profile,
    mode,
    stage: clean,
    required_for_stage: requiredForStage,
    disabled_reason: typeof inputPolicy.disabled_reason === 'string' && inputPolicy.disabled_reason.trim()
      ? inputPolicy.disabled_reason.trim()
      : null
  };
}

function hasPendingChanges(index = {}) {
  const pending = index.pendingChanges || index.pending_changes || {};
  return ['added', 'modified', 'removed'].some((key) => Number(pending[key] || 0) > 0);
}

function stageEvidenceSummary(evidenceIndex, stage) {
  if (!evidenceIndex || typeof evidenceIndex !== 'object') return null;
  const byStage = evidenceIndex.by_stage || {};
  return byStage[stage] || null;
}

function hasBlockingEvidenceGap(evidenceIndex, stage) {
  const summary = stageEvidenceSummary(evidenceIndex, stage);
  if (!summary) return false;
  return Number(summary.missing || 0) > 0
    || Number(summary.stale || 0) > 0
    || Number(summary.blocking || 0) > 0;
}

function hasStageEvidence(evidenceIndex, stage) {
  const summary = stageEvidenceSummary(evidenceIndex, stage);
  if (!summary) return false;
  return ['verified', 'partial', 'missing', 'stale', 'blocking']
    .some((key) => Number(summary[key] || 0) > 0);
}

function hasAnyEvidence(evidenceIndex) {
  if (!evidenceIndex || typeof evidenceIndex !== 'object') return false;
  if (Number(evidenceIndex.record_count || 0) > 0) return true;
  return Object.values(evidenceIndex.by_stage || {}).some((summary) => {
    return summary && ['verified', 'partial', 'missing', 'stale', 'blocking']
      .some((key) => Number(summary[key] || 0) > 0);
  });
}

function resolve(stage, profileOrPolicy = {}, policyOrStatus = {}, statusOrEvidence = {}, maybeEvidence = null, options = {}) {
  let policyInput = profileOrPolicy || {};
  let status = policyOrStatus || {};
  let evidenceIndex = statusOrEvidence || null;

  if (typeof profileOrPolicy === 'string') {
    policyInput = { ...(policyOrStatus || {}), profile: profileOrPolicy };
    status = statusOrEvidence || {};
    evidenceIndex = maybeEvidence || null;
  }

  const clean = cleanStage(stage);
  const policy = normalizePolicy(clean, policyInput, status);
  const blockers = [];
  const warnings = [];
  const executionSurface = status.execution_surface || 'none';
  const index = status.index || {};

  if (policy.mode === 'disabled') {
    warnings.push('codegraph:disabled-for-project');
    if (!policy.disabled_reason) blockers.push('codegraph:missing-disabled-reason');
    return {
      schema: 'specnav.codegraph.decision.v1',
      stage: clean,
      profile: policy.profile,
      effective_mode: policy.mode,
      required_for_stage: false,
      execution_surface: executionSurface,
      result: blockers.length ? 'block' : 'warn',
      blockers: unique(blockers),
      warnings: unique(warnings),
      explanation: blockers.length
        ? 'CodeGraph is disabled without an auditable reason.'
        : 'CodeGraph is explicitly disabled for this project; no CodeGraph verification may be claimed.'
    };
  }

  if (policy.required_for_stage) {
    if (!status.cli || status.cli.available !== true) blockers.push('codegraph:cli-missing');
    if (status.cli && status.cli.unsupported === true) blockers.push('codegraph:unsupported-version');
    if (!index.initialized) blockers.push('codegraph:not-indexed');
    if (index.reindexRecommended === true || hasPendingChanges(index)) blockers.push('codegraph:index-stale');
    if (index.worktreeMismatch) blockers.push('codegraph:wrong-project-root');
    if (options.requireEvidence === true) {
      if (evidenceIndex && Array.isArray(evidenceIndex.blockers)) blockers.push(...evidenceIndex.blockers);
      if (!hasAnyEvidence(evidenceIndex) || !hasStageEvidence(evidenceIndex, clean)) blockers.push('codegraph:coverage-gap');
      else {
        if (hasBlockingEvidenceGap(evidenceIndex, clean)) blockers.push('codegraph:claim-unverified');
      }
    }
  } else if (policy.mode === 'observe' || policy.mode === 'advisory') {
    if (!status.cli || status.cli.available !== true) warnings.push('codegraph:cli-missing');
    if (status.cli && status.cli.unsupported === true) warnings.push('codegraph:unsupported-version');
    if (!index.initialized) warnings.push('codegraph:not-indexed');
    if (index.reindexRecommended === true || hasPendingChanges(index)) warnings.push('codegraph:index-stale');
    if (index.worktreeMismatch) warnings.push('codegraph:wrong-project-root');
  }

  const result = blockers.length ? 'block' : (warnings.length ? 'warn' : 'pass');
  return {
    schema: 'specnav.codegraph.decision.v1',
    stage: clean,
    profile: policy.profile,
    effective_mode: policy.mode,
    required_for_stage: policy.required_for_stage,
    execution_surface: executionSurface,
    result,
    blockers: unique(blockers),
    warnings: unique(warnings),
    explanation: result === 'pass'
      ? `CodeGraph policy satisfied for ${clean}.`
      : result === 'warn'
        ? `CodeGraph policy has advisory warnings for ${clean}.`
        : `CodeGraph policy blocks ${clean}.`
  };
}

module.exports = {
  PROFILE_DEFAULTS,
  normalizePolicy,
  resolve
};
