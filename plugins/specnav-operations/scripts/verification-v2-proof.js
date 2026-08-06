#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./plugin-runtime');
const safeFs = require('./safe-filesystem');

const kernel = runtime.requirePluginScript('specnav-verification', 'kernel');
const {
  createTrustedFactAuthority
} = runtime.requirePluginScript(
  'specnav-verification',
  'kernel/repair'
);
const core = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

const REQUIRED_HOSTS = Object.freeze(['claude-code', 'codex', 'codefree-o']);
const REQUIRED_REPORTS = Object.freeze([
  'overview.html',
  'test-case-catalog.html',
  'test-case-results.html'
]);
const PROOF_SCHEMA = 'specnav.operations.verification-v2-proof.v1';
const HOST_DESCRIPTORS = Object.freeze({
  codex: Object.freeze({
    plugin: 'plugins/specnav-verification',
    manifest: null,
    hostFiles: Object.freeze(['scripts/codex-verification-adapter.js'])
  }),
  'claude-code': Object.freeze({
    plugin: 'plugins/specnav-verification',
    manifest: 'plugins/specnav-verification/specnav-kernel-source.json',
    hostFiles: Object.freeze([
      'commands/specnav-verification.md',
      'commands/specnav-verify.md',
      'scripts/claude-verification-adapter.js',
      'scripts/plugin-runtime.js',
      'specnav-stage.json',
      '.claude-plugin/plugin.json'
    ])
  }),
  'codefree-o': Object.freeze({
    plugin: 'modules/specnav-verification',
    manifest: 'modules/specnav-verification/specnav-kernel-source.json',
    hostFiles: Object.freeze([
      'scripts/codefree-o-verification-adapter.js',
      'scripts/plugin-runtime.js',
      'specnav-stage.json'
    ])
  })
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isConcreteString(value) {
  return typeof value === 'string'
    && value.trim() === value
    && value !== ''
    && !/<(?:decision-required|todo|tbd)>/i.test(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function blocker(id, artifact = null, detail = null) {
  return { id, artifact, detail };
}

function stableBlockers(values) {
  const byKey = new Map();
  for (const value of values) {
    const normalized = {
      id: value.id,
      artifact: value.artifact ?? null,
      detail: value.detail ?? null
    };
    byKey.set(canonicalJson(normalized), normalized);
  }
  return [...byKey.values()].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ));
}

function pathInside(base, relative, artifact) {
  if (
    typeof relative !== 'string'
    || relative.trim() !== relative
    || relative === ''
    || path.isAbsolute(relative)
    || relative.includes('\\')
    || relative.split('/').includes('..')
  ) {
    throw new Error(`verification-release:path-unsafe:${artifact}`);
  }
  const root = path.resolve(base);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`verification-release:path-unsafe:${artifact}`);
  }
  let cursor = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`verification-release:path-symlink:${artifact}`);
    }
  }
  return target;
}

function resolveChangeDirectory(projectRoot, changeId, blockers) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(projectRoot));
  } catch {
    blockers.push(blocker('verification-release:project-root-invalid'));
    return { root: null, change: null, changeDir: null };
  }

  const state = changeId === null
    ? core.activeChangeState(root)
    : core.activeChangeState(root, { change: changeId });
  if (!state.change) {
    blockers.push(blocker(
      changeId === null
        ? 'verification-release:active-change-missing'
        : 'verification-release:change-invalid'
    ));
    return { root, change: null, changeDir: null };
  }

  const change = state.change;
  const changesRoot = path.join(root, 'openspec', 'changes');
  const changeDir = path.join(changesRoot, change);
  try {
    const relative = path.relative(root, changeDir);
    pathInside(root, relative, `openspec/changes/${change}`);
    if (!fs.existsSync(changeDir)) {
      blockers.push(blocker(
        'verification-release:change-missing',
        `openspec/changes/${change}`
      ));
      return { root, change, changeDir: null };
    }
    if (fs.lstatSync(changeDir).isSymbolicLink()) {
      blockers.push(blocker(
        'verification-release:change-path-symlink',
        `openspec/changes/${change}`
      ));
      return { root, change, changeDir: null };
    }
    if (!fs.statSync(changeDir).isDirectory()) {
      blockers.push(blocker(
        'verification-release:change-path-invalid',
        `openspec/changes/${change}`
      ));
      return { root, change, changeDir: null };
    }
    const realChangesRoot = fs.realpathSync(changesRoot);
    const realChangeDir = fs.realpathSync(changeDir);
    if (
      realChangeDir === realChangesRoot
      || !realChangeDir.startsWith(`${realChangesRoot}${path.sep}`)
    ) {
      blockers.push(blocker(
        'verification-release:change-path-escape',
        `openspec/changes/${change}`
      ));
      return { root, change, changeDir: null };
    }
  } catch (error) {
    blockers.push(blocker(
      error?.message?.includes('path-symlink')
        ? 'verification-release:change-path-symlink'
        : 'verification-release:change-path-invalid',
      `openspec/changes/${change}`
    ));
    return { root, change, changeDir: null };
  }
  return { root, change, changeDir };
}

function readFile(base, relative, artifact, blockers) {
  let file;
  try {
    file = pathInside(base, relative, artifact);
  } catch (error) {
    blockers.push(blocker(error.message, artifact));
    return null;
  }
  try {
    return safeFs.readRegularFile(
      base,
      file,
      `verification-release:artifact:${artifact}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    blockers.push(blocker(
      message.endsWith(':missing')
        ? `verification-release:artifact-missing:${artifact}`
        : message.includes(':symlink') || message.includes(':root-changed')
          ? `verification-release:path-symlink:${artifact}`
          : message.endsWith(':not-file')
            ? `verification-release:artifact-not-file:${artifact}`
          : `verification-release:artifact-unreadable:${artifact}`,
      artifact
    ));
    return null;
  }
}

function readJson(base, relative, artifact, blockers) {
  const bytes = readFile(base, relative, artifact, blockers);
  if (!bytes) return { value: null, bytes: null };
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value)) {
      blockers.push(blocker(`verification-release:artifact-shape-invalid:${artifact}`, artifact));
      return { value: null, bytes };
    }
    return { value, bytes };
  } catch {
    blockers.push(blocker(`verification-release:artifact-json-invalid:${artifact}`, artifact));
    return { value: null, bytes };
  }
}

function readJsonValue(base, relative, artifact, blockers) {
  const bytes = readFile(base, relative, artifact, blockers);
  if (!bytes) return { value: null, bytes: null };
  try {
    return {
      value: JSON.parse(bytes.toString('utf8')),
      bytes
    };
  } catch {
    blockers.push(blocker(
      `verification-release:artifact-json-invalid:${artifact}`,
      artifact
    ));
    return { value: null, bytes };
  }
}

function validateSchema(schemaRegistry, entityType, value, artifact, blockers) {
  if (!value) return null;
  try {
    const result = schemaRegistry.validate(entityType, value, {
      artifactPath: artifact
    });
    if (!result.ok) {
      blockers.push(blocker(
        `verification-release:schema-invalid:${artifact}`,
        artifact,
        result.blockers
      ));
      return null;
    }
    return result.value;
  } catch (error) {
    blockers.push(blocker(
      `verification-release:schema-validation-failed:${artifact}`,
      artifact,
      error instanceof Error ? error.message : String(error)
    ));
    return null;
  }
}

function exactIds(values) {
  return uniqueSorted(Array.isArray(values) ? values : []);
}

function sameIds(left, right) {
  return canonicalJson(exactIds(left)) === canonicalJson(exactIds(right));
}

function resolveRuntimeAuthority(candidate, authority, blockers) {
  let result;
  try {
    result = authority.resolve(candidate);
  } catch (error) {
    blockers.push(blocker(
      'verification-release:runtime-authority-unavailable',
      'verify/v2/runtime-status.json',
      error instanceof Error ? error.message : String(error)
    ));
    return null;
  }
  if (
    !result
    || result.ok !== true
    || !result.runtimeStatus
    || typeof result.runtimeRoot !== 'string'
    || !result.authority
    || !/^[a-f0-9]{64}$/.test(result.authority.digest || '')
  ) {
    blockers.push(...(Array.isArray(result?.blockers)
      ? result.blockers
      : [blocker(
          'verification-release:runtime-authority-unavailable',
          'verify/v2/runtime-status.json'
        )]));
    return null;
  }
  return result;
}

function git(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `git ${args.join(' ')} failed`
    );
  }
  return result.stdout;
}

function resolveCurrentFingerprints(
  projectRoot,
  snapshot,
  runtimeStatus,
  runtimeAuthority
) {
  const codeSha = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(codeSha)) {
    throw new Error('verification-release:git-head-invalid');
  }
  const status = git(projectRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ]);
  if (status.trim() !== '') {
    throw new Error('verification-release:dirty-worktree');
  }
  const testInventory = git(projectRoot, [
    'ls-tree',
    '-r',
    'HEAD',
    '--',
    'tests',
    'plugins/specnav-verification'
  ]);
  return {
    case_snapshot_hash: snapshot.snapshot_hash,
    code_sha: codeSha,
    test_sha: crypto.createHash('sha256')
      .update(testInventory)
      .update(snapshot.snapshot_hash)
      .digest('hex'),
    environment_hash: crypto.createHash('sha256')
      .update(JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        runtime_version: runtimeStatus.runtime_version,
        runtime_root: runtimeStatus.runtime_root,
        runtime_authority_hash: runtimeAuthority?.digest || null,
        kernel_version: kernel.metadata.version
      }))
      .digest('hex'),
    runtime_version: runtimeStatus.runtime_version,
    kernel_version: kernel.metadata.version
  };
}

function gateRequest(input, stage) {
  return {
    change_id: input.change_id,
    stage,
    aggregation_request: input.aggregation_request,
    open_failure_ids: input.open_failure_ids,
    failure_state_status: input.failure_state_status,
    failure_state_digest: input.failure_state_digest,
    authority_chain_digest: input.authority_chain_digest,
    freshness: input.freshness,
    integrity_status: input.integrity_status,
    evidence_index_version: input.evidence_index_version,
    runtime_version: input.runtime_version,
    kernel_version: input.kernel_version,
    policy_version: input.policy_version
  };
}

function completeGateInput(input, change) {
  const aggregation = input?.aggregation_request;
  return isRecord(input)
    && input.schema === 'specnav.verification.release-gate-input.v1'
    && input.change_id === change
    && input.lane === 'full'
    && isConcreteString(input.case_snapshot_id)
    && /^[a-f0-9]{64}$/.test(input.case_snapshot_hash || '')
    && isConcreteString(input.case_approval_id)
    && isConcreteString(input.case_approval_reviewer_id)
    && isRecord(aggregation)
    && aggregation.change_id === change
    && Array.isArray(aggregation.case_ids)
    && Array.isArray(aggregation.readings)
    && Array.isArray(aggregation.evidence)
    && isRecord(aggregation.integrity)
    && isRecord(aggregation.policy_facts)
    && Array.isArray(input.open_failure_ids)
    && ['valid', 'invalid'].includes(input.failure_state_status)
    && /^[a-f0-9]{64}$/.test(input.failure_state_digest || '')
    && /^[a-f0-9]{64}$/.test(input.authority_chain_digest || '')
    && isRecord(input.freshness)
    && isConcreteString(input.freshness.status)
    && isConcreteString(input.freshness.checked_at)
    && !Number.isNaN(Date.parse(input.freshness.checked_at))
    && Array.isArray(input.freshness.reasons)
    && isConcreteString(input.integrity_status)
    && Number.isInteger(input.evidence_index_version)
    && input.evidence_index_version >= 0
    && isConcreteString(input.runtime_version)
    && input.kernel_version === kernel.metadata.version
    && isConcreteString(input.policy_version);
}

function validatePersistedGate(schemaRegistry, input, persisted, stage, blockers) {
  const artifact = `verify/v2/${stage}-gate.json`;
  if (!persisted) return null;
  const validated = validateSchema(
    schemaRegistry,
    'gate-decision',
    persisted,
    artifact,
    blockers
  );
  if (!validated) return null;
  const identity = kernel.validateGateDecisionIdentity(validated);
  if (!identity.ok) {
    blockers.push(blocker(
      `verification-release:gate-identity-invalid:${stage}`,
      artifact,
      identity.blockers
    ));
  }
  const readingIds = input?.aggregation_request?.readings?.map((entry) => entry?.id);
  const caseIds = input?.aggregation_request?.case_ids;
  const bindingMatches = validated.change_id === input.change_id
    && validated.stage === stage
    && sameIds(validated.source_case_ids, caseIds)
    && sameIds(validated.source_reading_ids, readingIds)
    && validated.failure_state_status === input.failure_state_status
    && validated.failure_state_digest === input.failure_state_digest
    && validated.authority_chain_digest === input.authority_chain_digest
    && validated.evidence_index_version === input.evidence_index_version
    && validated.runtime_version === input.runtime_version
    && validated.kernel_version === input.kernel_version
    && canonicalJson(validated.freshness) === canonicalJson(input.freshness)
    && validated.integrity_status === input.integrity_status
    && validated.policy_version === input.policy_version;
  if (!bindingMatches) {
    blockers.push(blocker(
      `verification-release:gate-binding-mismatch:${stage}`,
      artifact
    ));
  }
  if (
    validated.decision !== 'pass'
    || validated.blockers.length > 0
    || input.freshness?.status !== 'fresh'
    || input.integrity_status !== 'intact'
    || input.failure_state_status !== 'valid'
    || input.open_failure_ids.length > 0
  ) {
    blockers.push(blocker(
      `verification-release:kernel-gate-not-pass:${stage}`,
      artifact,
      validated.blockers
    ));
  }

  let recomputed = null;
  try {
    const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
    const engine = kernel.createDecisionEngine({
      schemaRegistry,
      aggregator,
      clock: () => validated.decided_at
    });
    const result = engine.decide(gateRequest(input, stage));
    recomputed = result.gate;
    if (!recomputed) {
      blockers.push(blocker(
        `verification-release:gate-recompute-failed:${stage}`,
        artifact,
        result.blockers
      ));
    } else {
      if (
        recomputed.id !== validated.id
        || recomputed.decision !== validated.decision
      ) {
        blockers.push(blocker(
          `verification-release:gate-recompute-mismatch:${stage}`,
          artifact,
          {
            persisted_id: validated.id,
            persisted_decision: validated.decision,
            recomputed_id: recomputed.id,
            recomputed_decision: recomputed.decision
          }
        ));
      }
      if (!result.ok) {
        blockers.push(blocker(
          `verification-release:kernel-gate-not-pass:${stage}`,
          artifact,
          result.blockers
        ));
      }
    }
  } catch (error) {
    blockers.push(blocker(
      `verification-release:gate-recompute-failed:${stage}`,
      artifact,
      error instanceof Error ? error.message : String(error)
    ));
  }
  return recomputed || validated;
}

function validateApproval(
  schemaRegistry,
  snapshotCandidate,
  approvalCandidate,
  requirementsCandidate,
  acceptanceCandidate,
  input,
  blockers
) {
  const validator = kernel.createCaseApprovalValidator({ schemaRegistry });
  const result = validator.evaluate({
    snapshot: snapshotCandidate,
    approval: approvalCandidate,
    currentRequirements: requirementsCandidate,
    currentAcceptance: acceptanceCandidate,
    expectedReviewerId: input.case_approval_reviewer_id
  });
  const snapshot = result.snapshot;
  const approval = result.approval;
  if (!result.ok) {
    blockers.push(blocker(
      'verification-release:case-approval-invalid',
      'verify/v2/case-approval.json',
      result.blockers
    ));
    return { snapshot, approval };
  }
  const caseIds = snapshot.cases.map((entry) => entry.id);
  const aggregationCaseIds = input?.aggregation_request?.case_ids;
  const valid = approval.decision === 'approved'
    && approval.reviewer?.kind === 'human'
    && approval.reviewer.id === input.case_approval_reviewer_id
    && approval.change_id === input.change_id
    && approval.snapshot_id === snapshot.id
    && approval.snapshot_hash === snapshot.snapshot_hash
    && input.case_snapshot_id === snapshot.id
    && input.case_snapshot_hash === snapshot.snapshot_hash
    && input.case_approval_id === approval.id
    && sameIds(caseIds, aggregationCaseIds)
    && snapshot.cases.every((entry) => entry.status === 'ready');
  if (!valid) {
    blockers.push(blocker(
      'verification-release:case-approval-invalid',
      'verify/v2/case-approval.json'
    ));
  }
  return { snapshot, approval };
}

function validateReportModel(
  schemaRegistry,
  candidate,
  input,
  releaseGate,
  evidenceIndex,
  blockers
) {
  const artifact = 'verify/v2/report-model.json';
  const model = validateSchema(
    schemaRegistry,
    'report-model',
    candidate,
    artifact,
    blockers
  );
  if (!model || !releaseGate) return model;
  const readingIds = input.aggregation_request.readings.map((entry) => entry.id);
  const semantic = {
    change_id: model.change_id,
    verdict: model.verdict,
    sources: model.sources,
    summary: model.summary,
    catalog: model.catalog,
    results: model.results,
    blockers: model.blockers,
    warnings: model.warnings
  };
  if (model.id !== `report-model-${sha256(canonicalJson(semantic))}`) {
    blockers.push(blocker(
      'verification-release:report-identity-invalid',
      artifact
    ));
  }
  if (model.change_id !== input.change_id || model.verdict !== 'green') {
    blockers.push(blocker('verification-release:report-not-green', artifact));
  }
  if (model.sources.gate_decision_id !== releaseGate.id) {
    blockers.push(blocker('verification-release:report-gate-mismatch', artifact));
  }
  try {
    const aggregate = kernel.createSixDomainAggregator({
      schemaRegistry
    }).aggregate(input.aggregation_request);
    if (
      !aggregate.ok
      || !aggregate.id
      || model.sources.aggregate_id !== aggregate.id
    ) {
      blockers.push(blocker(
        'verification-release:report-aggregate-mismatch',
        artifact,
        aggregate.blockers
      ));
    }
  } catch (error) {
    blockers.push(blocker(
      'verification-release:report-aggregate-mismatch',
      artifact,
      error instanceof Error ? error.message : String(error)
    ));
  }
  if (!sameIds(model.sources.reading_ids, readingIds)) {
    blockers.push(blocker('verification-release:report-readings-mismatch', artifact));
  }
  if (model.sources.evidence_index_version !== input.evidence_index_version) {
    blockers.push(blocker(
      'verification-release:report-evidence-index-mismatch',
      artifact
    ));
  }
  if (
    evidenceIndex
    && (
      model.sources.evidence_index_version !== evidenceIndex.index_version
      || model.sources.evidence_index_digest !== evidenceIndex.source_digest
      || !sameIds(
        model.sources.evidence_ids,
        evidenceIndex.entries.map((entry) => entry.id)
      )
    )
  ) {
    blockers.push(blocker(
      'verification-release:report-evidence-source-mismatch',
      artifact
    ));
  }
  if (model.summary.runtime_version !== input.runtime_version) {
    blockers.push(blocker(
      'verification-release:report-runtime-version-mismatch',
      artifact
    ));
  }
  if (model.summary.kernel_version !== input.kernel_version) {
    blockers.push(blocker(
      'verification-release:report-kernel-version-mismatch',
      artifact
    ));
  }
  const repairLoop = model.summary.repair_loop;
  const noOpenRepairState = (
    model.summary.open_failure_ids.length === 0
    && model.summary.open_repair_ids.length === 0
  );
  const hasRepairHistory = (
    model.summary.totals.failures > 0
    || model.summary.totals.repairs > 0
    || repairLoop.failure_ids.length > 0
    || repairLoop.repair_ids.length > 0
  );
  const repairStateValid = hasRepairHistory
    ? repairLoop.status === 'closed' && noOpenRepairState
    : (
      repairLoop.status === 'not_started'
      && repairLoop.failure_ids.length === 0
      && repairLoop.repair_ids.length === 0
      && noOpenRepairState
    );
  if (
    model.summary.integrity !== 'intact'
    || model.summary.freshness?.status !== 'fresh'
    || !repairStateValid
  ) {
    blockers.push(blocker('verification-release:report-state-not-closed', artifact));
  }
  return model;
}

function validateEvidenceIndex(
  schemaRegistry,
  changeDir,
  candidate,
  rawBytes,
  input,
  blockers
) {
  const artifact = 'verify/evidence/index.json';
  const index = validateSchema(
    schemaRegistry,
    'evidence-index',
    candidate,
    artifact,
    blockers
  );
  if (!index || !rawBytes) return index;
  const inputEvidenceIds = input.aggregation_request.evidence
    .map((entry) => entry.id);
  const indexEvidence = [...index.entries].sort((left, right) => (
    left.id.localeCompare(right.id)
  ));
  const inputEvidence = [...input.aggregation_request.evidence]
    .sort((left, right) => left.id.localeCompare(right.id));
  if (
    index.change_id !== input.change_id
    || index.source_raw !== 'raw.jsonl'
    || index.source_digest !== sha256(rawBytes)
    || index.index_version !== input.evidence_index_version
    || index.record_count !== index.entries.length
    || !sameIds(index.entries.map((entry) => entry.id), inputEvidenceIds)
    || canonicalJson(indexEvidence) !== canonicalJson(inputEvidence)
  ) {
    blockers.push(blocker(
      'verification-release:evidence-index-binding-mismatch',
      artifact
    ));
  }
  return index;
}

function validateReports(changeDir, manifest, model, blockers) {
  const manifestArtifact = 'verify/v2/report-render-manifest.json';
  const entries = Array.isArray(manifest?.reports) ? manifest.reports : [];
  const names = entries.map((entry) => entry?.name);
  const exactSet = entries.length === REQUIRED_REPORTS.length
    && new Set(names).size === REQUIRED_REPORTS.length
    && REQUIRED_REPORTS.every((name) => names.includes(name));
  if (
    !manifest
    || manifest.schema !== 'specnav.verification.report-render-manifest.v1'
    || manifest.change_id !== model?.change_id
    || manifest.report_model_id !== model?.id
    || !isConcreteString(manifest.generated_at)
    || Number.isNaN(Date.parse(manifest.generated_at))
    || !exactSet
  ) {
    blockers.push(blocker(
      'verification-release:report-render-manifest-invalid',
      manifestArtifact
    ));
  }
  const reports = [];
  for (const name of REQUIRED_REPORTS) {
    const relative = `verify/reports/${name}`;
    const before = blockers.length;
    const bytes = readFile(changeDir, relative, relative, blockers);
    if (!bytes) {
      if (blockers.length > before) {
        blockers.splice(before, blockers.length - before, blocker(
          `verification-release:report-missing:${name}`,
          relative
        ));
      }
      continue;
    }
    if (bytes.length === 0) {
      blockers.push(blocker(`verification-release:report-empty:${name}`, relative));
      continue;
    }
    const actual = {
      name,
      path: relative,
      sha256: sha256(bytes),
      size: bytes.length
    };
    const recorded = entries.find((entry) => entry?.name === name);
    if (
      !recorded
      || recorded.path !== actual.path
      || recorded.sha256 !== actual.sha256
      || recorded.size !== actual.size
    ) {
      blockers.push(blocker(
        `verification-release:report-render-mismatch:${name}`,
        relative
      ));
    }
    reports.push(actual);
  }
  return reports;
}

function validateMigration(
  schemaRegistry,
  changeDir,
  status,
  input,
  blockers
) {
  const artifact = 'verify/v2/migration-status.json';
  if (
    !status
    || status.schema !== 'specnav.verification.migration-status.v1'
    || status.change_id !== input.change_id
    || typeof status.required !== 'boolean'
    || !Array.isArray(status.legacy_artifacts)
    || !/^[a-f0-9]{64}$/.test(status.source_inventory_digest || '')
    || status.fallback_used !== false
  ) {
    blockers.push(blocker('verification-release:migration-status-invalid', artifact));
    return { required: null, receipt: null };
  }
  if (!status.required) {
    if (status.legacy_artifacts.length > 0 || status.receipt_path) {
      blockers.push(blocker(
        'verification-release:migration-status-inconsistent',
        artifact
      ));
    }
    return { required: false, receipt: null };
  }
  const relative = status.receipt_path;
  if (typeof relative !== 'string') {
    blockers.push(blocker(
      'verification-release:migration-receipt-missing',
      artifact
    ));
    return { required: true, receipt: null };
  }
  const parsed = readJson(changeDir, relative, relative, blockers);
  if (!parsed.value) {
    blockers.push(blocker(
      'verification-release:migration-receipt-missing',
      relative
    ));
    return { required: true, receipt: null };
  }
  const receipt = validateSchema(
    schemaRegistry,
    'migration-receipt',
    parsed.value,
    relative,
    blockers
  );
  if (
    receipt
    && (
      receipt.change_id !== input.change_id
      || receipt.mode !== 'apply'
      || receipt.status !== 'succeeded'
      || receipt.validation?.ok !== true
      || receipt.validation?.blockers?.length > 0
      || receipt.rollback?.available !== true
      || receipt.fallback_used !== false
    )
  ) {
    blockers.push(blocker(
      'verification-release:migration-receipt-not-successful',
      relative
    ));
  }
  return {
    required: true,
    receipt: receipt ? {
      id: receipt.id,
      path: relative,
      sha256: parsed.bytes ? sha256(parsed.bytes) : null
    } : null
  };
}

function validateHostInstallations(
  changeDir,
  index,
  bindings,
  authority,
  blockers
) {
  const artifact = 'operations/host-installation-receipts.json';
  const hostIds = Array.isArray(index?.hosts)
    ? index.hosts.map((entry) => entry?.host)
    : [];
  const exactHosts = hostIds.length === REQUIRED_HOSTS.length
    && new Set(hostIds).size === REQUIRED_HOSTS.length
    && REQUIRED_HOSTS.every((host) => hostIds.includes(host));
  if (
    !index
    || index.schema !== 'specnav.verification.host-installation-index.v1'
    || index.fallback_used !== false
    || !Array.isArray(index.hosts)
  ) {
    blockers.push(blocker(
      'verification-release:host-installation-index-invalid',
      artifact
    ));
    return [];
  }
  if (!exactHosts) {
    blockers.push(blocker(
      'verification-release:host-installation-index-invalid',
      artifact
    ));
  }
  const records = [];
  for (const host of REQUIRED_HOSTS) {
    const entry = index.hosts.find((candidate) => candidate?.host === host);
    if (!entry) {
      blockers.push(blocker(
        `verification-release:host-installation-missing:${host}`,
        artifact
      ));
      continue;
    }
    const parsed = readJson(
      changeDir,
      entry.receipt_path,
      entry.receipt_path || `${host}-receipt`,
      blockers
    );
    if (!parsed.bytes) continue;
    const actualHash = sha256(parsed.bytes);
    if (actualHash !== entry.receipt_sha256) {
      blockers.push(blocker(
        `verification-release:install-receipt-hash-mismatch:${host}`,
        entry.receipt_path
      ));
    }
    if (!parsed.value) continue;
    const receipt = parsed.value;
    const valid = receipt.schema === 'specnav.verification.host-install-receipt.v1'
      && receipt.host === host
      && receipt.change_id === bindings.change_id
      && receipt.release_gate_id === bindings.release_gate_id
      && receipt.archive_gate_id === bindings.archive_gate_id
      && receipt.gate_input_sha256 === bindings.gate_input_sha256
      && receipt.evidence_index_digest === bindings.evidence_index_digest
      && receipt.commit === entry.commit
      && receipt.commit === authority?.commits?.[host]
      && /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/.test(receipt.source || '')
      && /^[a-f0-9]{40}$/.test(receipt.commit || '')
      && receipt.clean_checkout === true
      && receipt.plugin_discovered === true
      && receipt.runtime_ready === true
      && receipt.fixture_verification === 'pass'
      && isConcreteString(receipt.command)
      && receipt.exit_status === 0
      && receipt.attestation === 'system-executed'
      && receipt.fallback_used === false;
    if (!valid) {
      blockers.push(blocker(
        `verification-release:install-receipt-invalid:${host}`,
        entry.receipt_path
      ));
    }
    records.push({
      host,
      commit: entry.commit,
      receipt_path: entry.receipt_path,
      receipt_sha256: actualHash
    });
  }
  if (index.hosts.some((entry) => !REQUIRED_HOSTS.includes(entry?.host))) {
    blockers.push(blocker(
      'verification-release:host-installation-unknown-host',
      artifact
    ));
  }
  return records.sort((left, right) => left.host.localeCompare(right.host));
}

function validateCompatibility(
  candidate,
  input,
  hosts,
  bindings,
  authority,
  blockers
) {
  const artifact = 'operations/cross-host-compatibility.json';
  const commits = new Map(hosts.map((entry) => [entry.host, entry.commit]));
  const candidateHostIds = Array.isArray(candidate?.hosts)
    ? candidate.hosts.map((entry) => entry?.host)
    : [];
  const validHosts = Array.isArray(candidate?.hosts)
    && candidate.hosts.length === REQUIRED_HOSTS.length
    && new Set(candidateHostIds).size === REQUIRED_HOSTS.length
    && REQUIRED_HOSTS.every((host) => candidateHostIds.includes(host))
    && candidate.hosts.every((entry) => (
      REQUIRED_HOSTS.includes(entry?.host)
      && commits.get(entry.host) === entry.commit
    ));
  if (
    !candidate
    || candidate.schema !== 'specnav.verification.cross-host-release-result.v1'
    || candidate.change_id !== input.change_id
    || candidate.release_gate_id !== bindings.release_gate_id
    || candidate.archive_gate_id !== bindings.archive_gate_id
    || candidate.gate_input_sha256 !== bindings.gate_input_sha256
    || candidate.evidence_index_digest !== bindings.evidence_index_digest
    || candidate.ok !== true
    || candidate.kernel_version !== input.kernel_version
    || !validHosts
    || authority?.comparison?.ok !== true
    || canonicalJson(candidate.blockers)
      !== canonicalJson(authority?.comparison?.blockers || [])
    || !Array.isArray(candidate.blockers)
    || candidate.blockers.length > 0
    || candidate.fallback_used !== false
  ) {
    blockers.push(blocker(
      'verification-release:cross-host-compatibility-blocked',
      artifact,
      candidate?.blockers || null
    ));
  }
  return candidate ? {
    ok: candidate.ok === true,
    kernel_version: candidate.kernel_version || null,
    hosts: Array.isArray(candidate.hosts) ? candidate.hosts : [],
    sha256: sha256(Buffer.from(canonicalJson(candidate)))
  } : null;
}

function proofPath(changeDir, relative) {
  try {
    return pathInside(changeDir, relative, relative);
  } catch (error) {
    throw new Error(
      error?.message?.includes('path-symlink')
        ? 'verification-release:proof-path-symlink'
        : 'verification-release:proof-path-unsafe'
    );
  }
}

function atomicWriteJson(changeDir, relative, value) {
  const file = proofPath(changeDir, relative);
  try {
    safeFs.atomicWriteJson(
      changeDir,
      file,
      value,
      'verification-release:proof-path'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes(':symlink') || message.includes(':root-changed')) {
      throw new Error('verification-release:proof-path-symlink');
    }
    if (message.includes(':path-escape')) {
      throw new Error('verification-release:proof-path-unsafe');
    }
    throw new Error('verification-release:proof-write-failed');
  }
}

function createReleaseProofValidator(options = {}) {
  const clock = options.clock || (() => new Date().toISOString());
  const runtimeAuthority = options.runtimeAuthority
    || kernel.createRuntimeAuthority();
  const hostCompatibilityAuthority = options.hostCompatibilityAuthority
    || kernel.createHostCompatibilityAuthority({
      lockFile: process.env.SPECNAV_VERIFICATION_HOST_LOCK,
      fixtureRoot: process.env.SPECNAV_VERIFICATION_FIXTURE_ROOT,
      descriptors: HOST_DESCRIPTORS,
      sourceHost: 'codex',
      roots: {
        codex: process.env.SPECNAV_CODEX_REPOSITORY_ROOT,
        'claude-code': process.env.SPECNAV_CLAUDE_REPOSITORY_ROOT,
        'codefree-o': process.env.SPECNAV_CODEFREE_O_REPOSITORY_ROOT
      }
    });
  if (typeof clock !== 'function') {
    throw new Error('verification-release:clock-invalid');
  }

  function validate(projectRoot, changeId = null) {
    const blockers = [];
    const resolved = resolveChangeDirectory(projectRoot, changeId, blockers);
    const { root, change, changeDir } = resolved;
    if (!change || !changeDir) {
      return {
        ok: false,
        change_id: change,
        proof: null,
        blockers: stableBlockers(blockers)
      };
    }
    const runtimeStatusRead = readJson(
      changeDir,
      'verify/v2/runtime-status.json',
      'verify/v2/runtime-status.json',
      blockers
    );
    const runtimeResolution = resolveRuntimeAuthority(
      runtimeStatusRead.value,
      runtimeAuthority,
      blockers
    );
    const schemaRegistry = options.schemaRegistry || (
      runtimeResolution
        ? kernel.createSchemaRegistry({
            runtimeStatus: runtimeResolution.runtimeStatus,
            runtimeRoot: runtimeResolution.runtimeRoot
          })
        : null
    );
    if (
      schemaRegistry
      && runtimeResolution
      && typeof schemaRegistry.runtime_root === 'string'
      && fs.realpathSync(schemaRegistry.runtime_root)
        !== fs.realpathSync(runtimeResolution.runtimeRoot)
    ) {
      blockers.push(blocker(
        'verification-release:schema-registry-authority-mismatch',
        'verify/v2/runtime-status.json'
      ));
    }
    if (!schemaRegistry) {
      return {
        ok: false,
        change_id: change,
        proof: null,
        blockers: stableBlockers(blockers)
      };
    }

    const inputRead = readJson(
      changeDir,
      'verify/v2/gate-input.json',
      'verify/v2/gate-input.json',
      blockers
    );
    const input = inputRead.value;
    const inputComplete = completeGateInput(input, change);
    if (!inputComplete) {
      blockers.push(blocker(
        'verification-release:gate-input-invalid',
        'verify/v2/gate-input.json'
      ));
    }
    if (
      input?.lane !== undefined
      && !['standard', 'full'].includes(input.lane)
    ) {
      blockers.push(blocker(
        'verification-release:light-mode-not-supported',
        'verify/v2/gate-input.json'
      ));
    }
    if (
      inputComplete
      && runtimeResolution
      && input.runtime_version
        !== runtimeResolution.runtimeStatus.runtime_version
    ) {
      blockers.push(blocker(
        'verification-release:runtime-version-mismatch',
        'verify/v2/gate-input.json'
      ));
    }

    const snapshotRead = readJson(
      changeDir,
      'verify/v2/case-snapshot.json',
      'verify/v2/case-snapshot.json',
      blockers
    );
    const approvalRead = readJson(
      changeDir,
      'verify/v2/case-approval.json',
      'verify/v2/case-approval.json',
      blockers
    );
    const requirementsRead = readJsonValue(
      changeDir,
      'verify/v2/requirements-source.json',
      'verify/v2/requirements-source.json',
      blockers
    );
    const acceptanceRead = readJsonValue(
      changeDir,
      'verify/v2/acceptance-source.json',
      'verify/v2/acceptance-source.json',
      blockers
    );
    const releaseRead = readJson(
      changeDir,
      'verify/v2/release-gate.json',
      'verify/v2/release-gate.json',
      blockers
    );
    const archiveRead = readJson(
      changeDir,
      'verify/v2/archive-gate.json',
      'verify/v2/archive-gate.json',
      blockers
    );
    const reportRead = readJson(
      changeDir,
      'verify/v2/report-model.json',
      'verify/v2/report-model.json',
      blockers
    );
    const reportManifestRead = readJson(
      changeDir,
      'verify/v2/report-render-manifest.json',
      'verify/v2/report-render-manifest.json',
      blockers
    );
    const migrationRead = readJson(
      changeDir,
      'verify/v2/migration-status.json',
      'verify/v2/migration-status.json',
      blockers
    );
    const evidenceRaw = readFile(
      changeDir,
      'verify/evidence/raw.jsonl',
      'verify/evidence/raw.jsonl',
      blockers
    );
    const evidenceIndexRead = readJson(
      changeDir,
      'verify/evidence/index.json',
      'verify/evidence/index.json',
      blockers
    );
    const installRead = readJson(
      changeDir,
      'operations/host-installation-receipts.json',
      'operations/host-installation-receipts.json',
      blockers
    );
    const compatibilityRead = readJson(
      changeDir,
      'operations/cross-host-compatibility.json',
      'operations/cross-host-compatibility.json',
      blockers
    );
    const canonicalReads = {
      runs: readJsonValue(
        changeDir,
        'verify/v2/runs.json',
        'verify/v2/runs.json',
        blockers
      ),
      attempts: readJsonValue(
        changeDir,
        'verify/v2/attempts.json',
        'verify/v2/attempts.json',
        blockers
      ),
      readings: readJsonValue(
        changeDir,
        'verify/v2/readings.json',
        'verify/v2/readings.json',
        blockers
      ),
      failures: readJsonValue(
        changeDir,
        'verify/v2/failures.json',
        'verify/v2/failures.json',
        blockers
      ),
      repairLinks: readJsonValue(
        changeDir,
        'verify/v2/repair-links.json',
        'verify/v2/repair-links.json',
        blockers
      ),
      freshness: readJson(
        changeDir,
        'verify/v2/freshness.json',
        'verify/v2/freshness.json',
        blockers
      ),
      integrity: readJson(
        changeDir,
        'verify/v2/integrity.json',
        'verify/v2/integrity.json',
        blockers
      ),
      failureState: readJson(
        changeDir,
        'verify/v2/failure-state.json',
        'verify/v2/failure-state.json',
        blockers
      ),
      authorityAnchor: readJson(
        changeDir,
        'verify/v2/authority-chain-anchor.json',
        'verify/v2/authority-chain-anchor.json',
        blockers
      ),
      proposals: {
        bytes: readFile(
          changeDir,
          'verify/v2/transition-proposals.jsonl',
          'verify/v2/transition-proposals.jsonl',
          blockers
        )
      },
      receipts: {
        bytes: readFile(
          changeDir,
          'verify/v2/transition-receipts.jsonl',
          'verify/v2/transition-receipts.jsonl',
          blockers
        )
      },
      attemptFacts: {
        bytes: readFile(
          changeDir,
          'verify/v2/attempt-facts.jsonl',
          'verify/v2/attempt-facts.jsonl',
          blockers
        )
      }
    };

    let approval = { snapshot: null, approval: null };
    let releaseGate = null;
    let archiveGate = null;
    let model = null;
    let evidenceIndex = null;
    let migration = { required: null, receipt: null };
    let hosts = [];
    let compatibility = null;
    let hostAuthorityResult = null;
    let canonicalRebuild = null;
    if (inputComplete) {
      approval = validateApproval(
        schemaRegistry,
        snapshotRead.value,
        approvalRead.value,
        requirementsRead.value,
        acceptanceRead.value,
        input,
        blockers
      );
      let trustedFactAuthority = options.trustedFactAuthority || null;
      if (
        !trustedFactAuthority
        && runtimeResolution?.signingKey
      ) {
        try {
          trustedFactAuthority = createTrustedFactAuthority({
            schemaRegistry,
            key: runtimeResolution.signingKey,
            clock: () => input.freshness.checked_at
          });
        } catch (error) {
          blockers.push(blocker(
            'verification-release:trusted-fact-authority-unavailable',
            'verify/v2/failure-state.json',
            error instanceof Error ? error.message : String(error)
          ));
        }
      }
      if (!trustedFactAuthority) {
        blockers.push(blocker(
          'verification-release:trusted-fact-authority-unavailable',
          'verify/v2/failure-state.json'
        ));
      } else if (approval.snapshot && approval.approval && runtimeResolution) {
        try {
          const fingerprintResolver = options.fingerprints
            || resolveCurrentFingerprints;
          const currentFingerprints = fingerprintResolver(
            root,
            approval.snapshot,
            runtimeResolution.runtimeStatus,
            runtimeResolution.authority
          );
          canonicalRebuild = kernel.createVerificationArtifactPipeline({
            kernel,
            schemaRegistry,
            changeRoot: changeDir,
            verificationRoot: path.join(changeDir, 'verify'),
            snapshot: approval.snapshot,
            approval: approval.approval,
            currentFingerprints,
            trustedFactAuthority,
            clock: () => input.freshness.checked_at,
            secrets: [],
            policyVersion: input.policy_version
          }).build({ persist: false });
          if (!canonicalRebuild.ok) {
            blockers.push(blocker(
              'verification-release:canonical-rebuild-blocked',
              'verify/v2',
              canonicalRebuild.blockers
            ));
          }
          if (
            !canonicalRebuild.gate_input
            || canonicalJson(canonicalRebuild.gate_input)
              !== canonicalJson(input)
          ) {
            blockers.push(blocker(
              'verification-release:canonical-gate-input-mismatch',
              'verify/v2/gate-input.json'
            ));
          }
          for (const [name, persisted, rebuilt] of [
            [
              'freshness',
              canonicalReads.freshness.value,
              canonicalRebuild.freshness
            ],
            [
              'integrity',
              canonicalReads.integrity.value,
              canonicalRebuild.integrity
            ],
            [
              'failure-state',
              canonicalReads.failureState.value,
              canonicalRebuild.failure_state
            ],
            [
              'authority-chain-anchor',
              canonicalReads.authorityAnchor.value,
              canonicalRebuild.authority_chain_anchor
            ]
          ]) {
            if (
              !persisted
              || !rebuilt
              || canonicalJson(persisted) !== canonicalJson(rebuilt)
            ) {
              blockers.push(blocker(
                `verification-release:canonical-${name}-mismatch`,
                `verify/v2/${name}.json`
              ));
            }
          }
        } catch (error) {
          blockers.push(blocker(
            'verification-release:canonical-rebuild-failed',
            'verify/v2',
            error instanceof Error ? error.message : String(error)
          ));
        }
      }
      releaseGate = validatePersistedGate(
        schemaRegistry,
        input,
        releaseRead.value,
        'release',
        blockers
      );
      archiveGate = validatePersistedGate(
        schemaRegistry,
        input,
        archiveRead.value,
        'archive',
        blockers
      );
      evidenceIndex = validateEvidenceIndex(
        schemaRegistry,
        changeDir,
        evidenceIndexRead.value,
        evidenceRaw,
        input,
        blockers
      );
      model = validateReportModel(
        schemaRegistry,
        reportRead.value,
        input,
        releaseGate,
        evidenceIndex,
        blockers
      );
      migration = validateMigration(
        schemaRegistry,
        changeDir,
        migrationRead.value,
        input,
        blockers
      );
      const releaseBindings = {
        change_id: input.change_id,
        release_gate_id: releaseGate?.id || null,
        archive_gate_id: archiveGate?.id || null,
        gate_input_sha256: inputRead.bytes ? sha256(inputRead.bytes) : null,
        evidence_index_digest: evidenceIndex?.source_digest || null
      };
      try {
        hostAuthorityResult = hostCompatibilityAuthority.resolve();
      } catch (error) {
        hostAuthorityResult = {
          ok: false,
          blockers: [blocker(
            'verification-release:host-authority-unavailable',
            'host-authority',
            error instanceof Error ? error.message : String(error)
          )]
        };
      }
      if (hostAuthorityResult?.ok !== true) {
        blockers.push(...(hostAuthorityResult?.blockers || [blocker(
          'verification-release:host-authority-unavailable',
          'host-authority'
        )]));
      }
      hosts = validateHostInstallations(
        changeDir,
        installRead.value,
        releaseBindings,
        hostAuthorityResult,
        blockers
      );
      compatibility = validateCompatibility(
        compatibilityRead.value,
        input,
        hosts,
        releaseBindings,
        hostAuthorityResult,
        blockers
      );
    }
    const reports = validateReports(
      changeDir,
      reportManifestRead.value,
      model,
      blockers
    );
    const finalBlockers = stableBlockers(blockers);
    const generatedAt = clock();
    const sources = {
      gate_input: inputRead.bytes ? sha256(inputRead.bytes) : null,
      runtime_status: runtimeStatusRead.bytes
        ? sha256(runtimeStatusRead.bytes)
        : null,
      runtime_authority: runtimeResolution?.authority?.digest || null,
      case_snapshot: snapshotRead.bytes ? sha256(snapshotRead.bytes) : null,
      case_approval: approvalRead.bytes ? sha256(approvalRead.bytes) : null,
      requirements_source: requirementsRead.bytes
        ? sha256(requirementsRead.bytes)
        : null,
      acceptance_source: acceptanceRead.bytes
        ? sha256(acceptanceRead.bytes)
        : null,
      release_gate: releaseRead.bytes ? sha256(releaseRead.bytes) : null,
      archive_gate: archiveRead.bytes ? sha256(archiveRead.bytes) : null,
      report_model: reportRead.bytes ? sha256(reportRead.bytes) : null,
      report_render_manifest: reportManifestRead.bytes
        ? sha256(reportManifestRead.bytes)
        : null,
      evidence_raw: evidenceRaw ? sha256(evidenceRaw) : null,
      evidence_index: evidenceIndexRead.bytes
        ? sha256(evidenceIndexRead.bytes)
        : null,
      migration_status: migrationRead.bytes ? sha256(migrationRead.bytes) : null,
      host_installations: installRead.bytes ? sha256(installRead.bytes) : null,
      cross_host_compatibility: compatibilityRead.bytes
        ? sha256(compatibilityRead.bytes)
        : null
    };
    const semantic = {
      change_id: change,
      ok: finalBlockers.length === 0,
      sources,
      case_snapshot_id: approval.snapshot?.id || null,
      case_approval_id: approval.approval?.id || null,
      case_approval_reviewer_id: approval.approval?.reviewer?.id || null,
      runtime_authority: runtimeResolution?.authority || null,
      host_authority: hostAuthorityResult?.summary || null,
      release_gate: releaseGate ? {
        id: releaseGate.id,
        decision: releaseGate.decision,
        source_case_ids: releaseGate.source_case_ids,
        source_reading_ids: releaseGate.source_reading_ids,
        failure_state_status: releaseGate.failure_state_status,
        failure_state_digest: releaseGate.failure_state_digest,
        authority_chain_digest: releaseGate.authority_chain_digest,
        evidence_index_version: releaseGate.evidence_index_version,
        runtime_version: releaseGate.runtime_version,
        kernel_version: releaseGate.kernel_version,
        freshness: releaseGate.freshness,
        integrity_status: releaseGate.integrity_status
      } : null,
      archive_gate: archiveGate ? {
        id: archiveGate.id,
        decision: archiveGate.decision
      } : null,
      report_model_id: model?.id || null,
      evidence_index: evidenceIndex ? {
        version: evidenceIndex.index_version,
        source_digest: evidenceIndex.source_digest,
        record_count: evidenceIndex.record_count
      } : null,
      reports,
      migration,
      hosts,
      compatibility,
      blockers: finalBlockers,
      fallback_used: false
    };
    const proof = {
      schema: PROOF_SCHEMA,
      id: `verification-release-proof-${sha256(canonicalJson(semantic))}`,
      generated_at: generatedAt,
      ...semantic
    };
    try {
      atomicWriteJson(
        changeDir,
        'operations/verification-v2-proof.json',
        proof
      );
    } catch (error) {
      const writeBlockers = stableBlockers([
        ...finalBlockers,
        blocker(
          error instanceof Error
            ? error.message
            : 'verification-release:proof-write-failed',
          'operations/verification-v2-proof.json'
        )
      ]);
      return {
        ok: false,
        change_id: change,
        proof: { ...proof, ok: false, blockers: writeBlockers },
        blockers: writeBlockers
      };
    }
    return {
      ok: proof.ok,
      change_id: change,
      proof,
      blockers: finalBlockers
    };
  }

  return Object.freeze({ validate });
}

function markdown(result) {
  const lines = [
    '# Verification 2.0 Release And Archive Proof',
    '',
    `- change: \`${result.change_id || 'none'}\``,
    `- ok: ${result.ok}`,
    `- blockers: ${result.blockers.map((entry) => entry.id).join(', ') || '-'}`,
    ''
  ];
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const projectRoot = process.env.PROJECT_DIR || process.cwd();
  const changeIndex = args.indexOf('--change');
  const change = changeIndex >= 0 ? args[changeIndex + 1] : null;
  const validator = createReleaseProofValidator();
  const result = validator.validate(projectRoot, change);
  process.stdout.write(
    args.includes('--json')
      ? `${JSON.stringify(result, null, 2)}\n`
      : markdown(result)
  );
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  PROOF_SCHEMA,
  REQUIRED_HOSTS,
  REQUIRED_REPORTS,
  createReleaseProofValidator
};
