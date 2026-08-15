#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const safeFs = require('./safe-filesystem');
const {
  requireTrustedCore,
  trustedVerificationRoot
} = require('./verification-v2-trusted-runtime');
const {
  validateHostProofPointerChain
} = require('./verification-v2-pointer-chain');
const {
  HOST_DESCRIPTORS,
  REQUIRED_HOSTS,
  hostProofRunnerSourceDigest,
  managedFixtureManifestDigest,
  officialHostLockValid
} = require('./verification-v2-host-contract');

const LOCAL_REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const LOCAL_VERIFICATION_ROOT = trustedVerificationRoot(
  LOCAL_REPOSITORY_ROOT
);
const kernel = require(path.join(LOCAL_VERIFICATION_ROOT, 'kernel'));
const {
  createTrustedFactAuthority
} = require(path.join(LOCAL_VERIFICATION_ROOT, 'kernel', 'repair'));
const core = requireTrustedCore(LOCAL_REPOSITORY_ROOT);

const REQUIRED_REPORTS = Object.freeze([
  'overview.html',
  'test-case-catalog.html',
  'test-case-results.html'
]);
const PROOF_SCHEMA = 'specnav.operations.verification-v2-proof.v1';

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
  const head = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) {
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
  const repositoryInventory = git(projectRoot, [
    'ls-tree',
    '-r',
    'HEAD'
  ]);
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
    code_sha: kernel.codeInventorySha(repositoryInventory),
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

function hostRepositoryLock(lock, host) {
  return host === 'codex' ? lock?.source : lock?.hosts?.[host];
}

function expectedCommandIds(host) {
  return [
    'checkout-detach',
    'checkout-fetch',
    'checkout-head',
    'checkout-init',
    'checkout-remote',
    ...(host === 'codex' ? ['checkout-tree'] : []),
    ...(['codefree-o', 'dsh'].includes(host) ? ['dependency-install'] : []),
    'host-smoke',
    'remote-ref',
    'runtime-doctor'
  ].sort();
}

function executableDigestValid(command) {
  try {
    const real = fs.realpathSync(command.executable_realpath);
    return real === command.argv[0]
      && real === command.executable_realpath
      && sha256(fs.readFileSync(real)) === command.executable_sha256;
  } catch {
    return false;
  }
}

function optionalExecutableDigestValid(realpath, digest) {
  if (realpath === null && digest === null) return true;
  try {
    const real = fs.realpathSync(realpath);
    return real === realpath
      && sha256(fs.readFileSync(real)) === digest;
  } catch {
    return false;
  }
}

function trustedSandboxExecutable(realpath) {
  try {
    const actual = fs.realpathSync(realpath);
    if (process.platform === 'darwin') {
      return actual === fs.realpathSync('/usr/bin/sandbox-exec');
    }
    if (process.platform === 'linux') {
      return ['/usr/bin/bwrap', '/bin/bwrap']
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => fs.realpathSync(candidate))
        .includes(actual);
    }
    return false;
  } catch {
    return false;
  }
}

function commandPlanValid(
  host,
  commands,
  receipt,
  locked,
  execution,
  outputs,
  runtimeAuthority,
  lock,
  checkoutRoots,
  expectedRunnerIdentitySha256,
  expectedRunnerSourceSha256,
  expectedFixtureManifestSha256,
  expectedSourceInventory,
  diagnostics = null
) {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const commandIdsValid = byId.size === commands.length
    && canonicalJson([...byId.keys()].sort())
      === canonicalJson(expectedCommandIds(host));
  const commandExecutionsValid = commands.every((command) => (
    command.exit_status === 0
    && command.signal === null
    && executableDigestValid(command)
  ));
  if (!commandIdsValid || !commandExecutionsValid) {
    if (diagnostics) {
      Object.assign(diagnostics, {
        command_ids_valid: commandIdsValid,
        command_executions_valid: commandExecutionsValid
      });
    }
    return false;
  }
  const checkoutRootsValid = isRecord(checkoutRoots)
    && REQUIRED_HOSTS.every((candidate) => (
      isConcreteString(checkoutRoots[candidate])
      && path.isAbsolute(checkoutRoots[candidate])
    ));
  const lockDescriptorsValid = isRecord(lock?.source)
    && isRecord(locked)
    && isConcreteString(lock.source.plugin_path)
    && isConcreteString(locked.repository)
    && isConcreteString(locked.ref)
    && isConcreteString(locked.commit);
  if (!checkoutRootsValid || !lockDescriptorsValid) {
    if (diagnostics) {
      Object.assign(diagnostics, {
        command_ids_valid: commandIdsValid,
        command_executions_valid: commandExecutionsValid,
        checkout_roots_valid: checkoutRootsValid,
        lock_descriptors_valid: lockDescriptorsValid
      });
    }
    return false;
  }
  const remote = byId.get('remote-ref');
  const init = byId.get('checkout-init');
  const addRemote = byId.get('checkout-remote');
  const fetch = byId.get('checkout-fetch');
  const detach = byId.get('checkout-detach');
  const head = byId.get('checkout-head');
  const doctor = byId.get('runtime-doctor');
  const smoke = byId.get('host-smoke');
  const tree = byId.get('checkout-tree');
  const checkoutRoot = receipt.checkout_realpath;
  const gitExecutable = remote.argv[0];
  const setupValid = canonicalJson(remote.argv)
      === canonicalJson([
        gitExecutable,
        'ls-remote',
        '--refs',
        locked.repository,
        locked.ref
      ])
    && canonicalJson(init.argv) === canonicalJson([
      gitExecutable,
      '-c',
      'core.hooksPath=/dev/null',
      'init',
      '--quiet'
    ])
    && canonicalJson(addRemote.argv) === canonicalJson([
      gitExecutable,
      '-c',
      'core.hooksPath=/dev/null',
      'remote',
      'add',
      'origin',
      locked.repository
    ])
    && canonicalJson(fetch.argv) === canonicalJson([
      gitExecutable,
      '-c',
      'core.hooksPath=/dev/null',
      'fetch',
      '--quiet',
      '--depth=1',
      'origin',
      locked.ref
    ])
    && canonicalJson(detach.argv) === canonicalJson([
      gitExecutable,
      '-c',
      'core.hooksPath=/dev/null',
      'checkout',
      '--quiet',
      '--detach',
      locked.commit
    ])
    && canonicalJson(head.argv) === canonicalJson([
      gitExecutable,
      'rev-parse',
      'HEAD^{commit}'
    ])
    && (
      host !== 'codex'
      || canonicalJson(tree.argv) === canonicalJson([
        gitExecutable,
        'ls-tree',
        '-r',
        'HEAD'
      ])
    );
  const managedRuntimeProbe = path.join(
    checkoutRoots.codex,
    lock.source.plugin_path,
    'scripts',
    'verification-runtime.js'
  );
  const probeValid = canonicalJson(doctor.argv)
      === canonicalJson([
        doctor.argv[0],
        managedRuntimeProbe,
        'doctor',
        '--version',
        runtimeAuthority?.runtime_version,
        '--project',
        checkoutRoot,
        '--root',
        path.dirname(runtimeAuthority?.runtime_root || ''),
        '--json'
      ])
    && canonicalJson(smoke.argv.slice(1))
      === canonicalJson([path.join(checkoutRoot, 'tests', 'run-smoke.sh')]);
  const dependencyValid = host !== 'codefree-o'
    || canonicalJson(byId.get('dependency-install').argv.slice(1))
      === canonicalJson([
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund'
      ]);
  const setupCommands = commands.filter((command) => (
    !['dependency-install', 'runtime-doctor', 'host-smoke']
      .includes(command.id)
  ));
  const sandboxedCommands = [
    ...(['codefree-o', 'dsh'].includes(host) ? [byId.get('dependency-install')] : []),
    doctor,
    smoke
  ];
  const workspaceRoots = new Set(
    Object.values(checkoutRoots).map((root) => path.dirname(root))
  );
  const workspace = workspaceRoots.size === 1
    ? [...workspaceRoots][0]
    : null;
  const nodeExecutable = doctor.argv[0];
  const sandboxPlanDiagnostics = [];
  const sandboxPlansValid = workspace !== null
    && sandboxedCommands.map((command) => {
      const executableValid = (
        trustedSandboxExecutable(command.sandbox_executable_realpath)
        && optionalExecutableDigestValid(
          command.sandbox_executable_realpath,
          command.sandbox_executable_sha256
        )
      );
      if (!executableValid) {
        sandboxPlanDiagnostics.push({
          id: command.id,
          executable_valid: false
        });
        return false;
      }
      const expected = kernel.createHostSandboxPlan({
        toolchain: {
          sandbox: {
            path: command.sandbox_executable_realpath,
            sha256: command.sandbox_executable_sha256
          }
        },
        allowedRoots: [
          ...REQUIRED_HOSTS.map((candidate) => checkoutRoots[candidate]),
          ...(command.id === 'runtime-doctor'
            ? [runtimeAuthority?.runtime_root]
            : []),
          path.dirname(path.dirname(nodeExecutable))
        ],
        writableRoots: [
          path.join(workspace, '.runtime', host),
          ...(command.id === 'dependency-install' ? [checkoutRoot] : [])
        ],
        pathAliases: [{
          path: workspace,
          identity: '$WORKSPACE'
        }],
        allowNetwork: command.id === 'dependency-install'
      });
      const argvValid = canonicalJson(command.sandbox_argv)
          === canonicalJson(expected.argv)
        && command.sandbox_policy_sha256 === expected.policy_sha256;
      sandboxPlanDiagnostics.push({
        id: command.id,
        executable_valid: true,
        argv_valid: argvValid,
        actual_argv: command.sandbox_argv,
        expected_argv: expected.argv
      });
      return argvValid;
    }).every(Boolean);
  const sandboxValid = setupCommands.every((command) => (
    command.sandbox_executable_realpath === null
    && command.sandbox_executable_sha256 === null
    && command.sandbox_policy_sha256 === null
    && command.sandbox_argv === null
  ))
    && sandboxPlansValid;
  const remoteOutput = outputs.get('remote-ref')?.toString('utf8').trim()
    .split(/\s+/)[0];
  const headOutput = outputs.get('checkout-head')?.toString('utf8').trim();
  const treeInventory = outputs.get('checkout-tree')?.toString('utf8');
  const observationsValid = remoteOutput === locked.commit
    && headOutput === locked.commit
    && execution.observations.advertised_commit === locked.commit
    && execution.observations.checkout_head === locked.commit
    && (
      host === 'codex'
        ? (
            execution.observations.source_code_inventory_sha
              === kernel.codeInventorySha(treeInventory || '')
            && execution.observations.source_code_inventory_sha
              === expectedSourceInventory
          )
        : execution.observations.source_code_inventory_sha === null
    )
    && (
      ['codefree-o', 'dsh'].includes(host)
        ? /^[a-f0-9]{64}$/.test(
            execution.observations.package_lock_sha256 || ''
          )
        : execution.observations.package_lock_sha256 === null
    );
  const runnerSourceValid =
    receipt.runner_source_sha256 === expectedRunnerSourceSha256
    && execution.runner_source_sha256 === expectedRunnerSourceSha256
    && receipt.runner_identity_sha256 === expectedRunnerIdentitySha256
    && execution.runner_identity_sha256 === expectedRunnerIdentitySha256;
  const fixtureManifestValid =
    receipt.fixture_manifest_sha256 === expectedFixtureManifestSha256
    && execution.fixture_manifest_sha256 === expectedFixtureManifestSha256;
  if (diagnostics) {
    Object.assign(diagnostics, {
      command_ids_valid: commandIdsValid,
      command_executions_valid: commandExecutionsValid,
      setup_valid: setupValid,
      probe_valid: probeValid,
      dependency_valid: dependencyValid,
      sandbox_valid: sandboxValid,
      sandbox_plans: sandboxPlanDiagnostics,
      observations_valid: observationsValid,
      runner_source_valid: runnerSourceValid,
      fixture_manifest_valid: fixtureManifestValid
    });
  }
  return setupValid
    && probeValid
    && dependencyValid
    && sandboxValid
    && observationsValid
    && runnerSourceValid
    && fixtureManifestValid;
}

function loadHostProofBundle(
  schemaRegistry,
  changeDir,
  pointerRead,
  changeId,
  runtimeAuthority,
  blockers
) {
  const artifact = 'operations/host-proof-current.json';
  const pointer = validateSchema(
    schemaRegistry,
    'host-proof-pointer',
    pointerRead.value,
    artifact,
    blockers
  );
  if (!pointer) return null;
  if (
    pointer.change_id !== changeId
    || pointer.runtime_authority_digest !== runtimeAuthority?.digest
  ) {
    blockers.push(blocker(
      'verification-release:host-proof-pointer-binding-mismatch',
      artifact
    ));
  }
  const reads = {};
  const expectedRunPrefix = `operations/host-proof-runs/${pointer.run_id}/`;
  const immutablePointerPath = `${expectedRunPrefix}host-proof-pointer.json`;
  const immutablePointerRead = readJson(
    changeDir,
    immutablePointerPath,
    immutablePointerPath,
    blockers
  );
  const immutablePointer = validateSchema(
    schemaRegistry,
    'host-proof-pointer',
    immutablePointerRead.value,
    immutablePointerPath,
    blockers
  );
  if (
    !immutablePointerRead.bytes
    || !pointerRead.bytes
    || !immutablePointerRead.bytes.equals(pointerRead.bytes)
    || !immutablePointer
  ) {
    blockers.push(blocker(
      'verification-release:host-proof-pointer-copy-mismatch',
      immutablePointerPath
    ));
  }
  try {
    validateHostProofPointerChain({
      changeId,
      pointer,
      pointerPath: artifact,
      readPointer(pointerPath) {
        return readJson(
          changeDir,
          pointerPath,
          pointerPath,
          blockers
        );
      },
      sha256,
      validatePointer(candidate, pointerArtifact) {
        const validated = validateSchema(
          schemaRegistry,
          'host-proof-pointer',
          candidate,
          pointerArtifact,
          blockers
        );
        if (!validated) {
          const error = new Error(
            'verification-release:host-proof-pointer-predecessor-invalid'
          );
          error.artifact = pointerArtifact;
          throw error;
        }
        return validated;
      }
    });
  } catch (error) {
    blockers.push(blocker(
      error instanceof Error
        ? error.message
        : 'verification-release:host-proof-pointer-chain-invalid',
      error?.artifact || artifact,
      error?.detail || null
    ));
  }
  for (const [name, entityType] of [
    ['lock', 'cross-host-lock'],
    ['index', 'host-installation-index'],
    ['compatibility', 'cross-host-release-result']
  ]) {
    const reference = pointer[name];
    if (!reference.path.startsWith(expectedRunPrefix)) {
      blockers.push(blocker(
        'verification-release:host-proof-run-mismatch',
        reference.path
      ));
    }
    const read = readJson(
      changeDir,
      reference.path,
      reference.path,
      blockers
    );
    reads[name] = read;
    if (
      !read.bytes
      || sha256(read.bytes) !== reference.sha256
    ) {
      blockers.push(blocker(
        `verification-release:host-proof-${name}-hash-mismatch`,
        reference.path
      ));
    }
    const validated = validateSchema(
      schemaRegistry,
      entityType,
      read.value,
      reference.path,
      blockers
    );
    reads[name].validated = validated;
  }
  if (
    pointer.host_lock_sha256 !== pointer.lock.sha256
    || reads.lock.validated
      && pointer.host_lock_sha256 !== sha256(reads.lock.bytes)
  ) {
    blockers.push(blocker(
      'verification-release:host-proof-lock-binding-mismatch',
      pointer.lock.path
    ));
  }
  if (!officialHostLockValid(reads.lock.validated)) {
    blockers.push(blocker(
      'verification-release:host-lock-policy-invalid',
      pointer.lock.path
    ));
  }
  return {
    pointer,
    immutablePointer: immutablePointerRead,
    ...reads
  };
}

function validateHostInstallations(
  schemaRegistry,
  trustedFactAuthority,
  changeDir,
  index,
  bindings,
  pointer,
  lock,
  runtimeAuthority,
  expectedRunnerSourceSha256,
  expectedFixtureManifestSha256,
  expectedSourceInventory,
  blockers
) {
  const artifact = pointer.index.path;
  const rawHostIds = Array.isArray(index?.hosts)
    ? index.hosts.map((entry) => entry?.host)
    : [];
  const validatedIndex = validateSchema(
    schemaRegistry,
    'host-installation-index',
    index,
    artifact,
    blockers
  );
  const effectiveIndex = validatedIndex || (
    index
    && typeof index === 'object'
    && !Array.isArray(index)
    && Array.isArray(index.hosts)
      ? index
      : null
  );
  if (!validatedIndex) {
    blockers.push(blocker(
      'verification-release:host-installation-index-invalid',
      artifact
    ));
    for (const host of REQUIRED_HOSTS) {
      if (!rawHostIds.includes(host)) {
        blockers.push(blocker(
          `verification-release:host-installation-missing:${host}`,
          artifact
        ));
      }
    }
    if (rawHostIds.some((host) => !REQUIRED_HOSTS.includes(host))) {
      blockers.push(blocker(
        'verification-release:host-installation-unknown-host',
        artifact
      ));
    }
    if (!effectiveIndex) return [];
  }
  const hostIds = effectiveIndex.hosts.map((entry) => entry?.host);
  const exactHosts = hostIds.length === REQUIRED_HOSTS.length
    && new Set(hostIds).size === REQUIRED_HOSTS.length
    && REQUIRED_HOSTS.every((host) => hostIds.includes(host));
  if (!exactHosts) {
    blockers.push(blocker(
      'verification-release:host-installation-index-invalid',
      artifact
    ));
  }
  if (
    effectiveIndex.change_id !== bindings.change_id
    || effectiveIndex.host_lock_sha256 !== pointer.host_lock_sha256
  ) {
    blockers.push(blocker(
      'verification-release:host-installation-index-binding-mismatch',
      artifact
    ));
  }
  const preloaded = new Map();
  const checkoutRoots = {};
  for (const host of REQUIRED_HOSTS) {
    const entry = effectiveIndex.hosts.find(
      (candidate) => candidate?.host === host
    );
    if (!entry) continue;
    const parsed = readJson(
      changeDir,
      entry.receipt_path,
      entry.receipt_path,
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
    const receipt = validateSchema(
      schemaRegistry,
      'host-install-receipt',
      parsed.value,
      entry.receipt_path,
      blockers
    );
    if (!receipt) {
      blockers.push(blocker(
        `verification-release:install-receipt-invalid:${host}`,
        entry.receipt_path
      ));
      continue;
    }
    const envelopeRead = readJson(
      changeDir,
      receipt.execution_envelope_path,
      receipt.execution_envelope_path,
      blockers
    );
    checkoutRoots[host] = receipt.checkout_realpath;
    preloaded.set(host, {
      actualHash,
      entry,
      receipt,
      envelopeRead
    });
  }
  function preloadedCommand(id, host = null) {
    const records = host
      ? [preloaded.get(host)].filter(Boolean)
      : [...preloaded.values()];
    for (const record of records) {
      const envelope = record.envelopeRead.value;
      const command = envelope?.payload?.commands?.find(
        (candidate) => candidate.id === id
      );
      if (command) return command;
    }
    return null;
  }
  let expectedRunnerIdentitySha256 = null;
  try {
    const commandByTool = {
      node: preloadedCommand('runtime-doctor'),
      git: preloadedCommand('remote-ref'),
      bash: preloadedCommand('host-smoke'),
      npm: preloadedCommand('dependency-install', host === 'dsh' ? 'dsh' : 'codefree-o'),
      sandbox: preloadedCommand('runtime-doctor')
    };
    const tools = Object.fromEntries(
      Object.entries(commandByTool).map(([name, command]) => {
        if (!command) throw new Error(`missing-tool:${name}`);
        return [name, {
          path: name === 'sandbox'
            ? command.sandbox_executable_realpath
            : command.executable_realpath,
          sha256: name === 'sandbox'
            ? command.sandbox_executable_sha256
            : command.executable_sha256
        }];
      })
    );
    expectedRunnerIdentitySha256 = kernel.createHostRunnerIdentity(
      expectedRunnerSourceSha256,
      tools
    );
  } catch (error) {
    blockers.push(blocker(
      'verification-release:runner-identity-unavailable',
      artifact,
      error instanceof Error ? error.message : String(error)
    ));
  }
  const records = [];
  for (const host of REQUIRED_HOSTS) {
    const preload = preloaded.get(host);
    if (!preload) {
      blockers.push(blocker(
        `verification-release:host-installation-missing:${host}`,
        artifact
      ));
      continue;
    }
    const { actualHash, entry, receipt, envelopeRead } = preload;
    const lockedRepository = hostRepositoryLock(lock, host);
    const envelopeHashValid = envelopeRead.bytes
      && sha256(envelopeRead.bytes) === receipt.execution_envelope_sha256;
    const envelopeVerification = envelopeRead.value
      ? trustedFactAuthority.verify(envelopeRead.value)
      : { ok: false };
    const execution = envelopeRead.value?.payload;
    if (!envelopeHashValid || !envelopeVerification.ok) {
      blockers.push(blocker(
        `verification-release:host-execution-envelope-invalid:${host}`,
        receipt.execution_envelope_path
      ));
    }
    const commandOutputs = new Map();
    const commandPlanDiagnostics = {};
    const outputReads = new Map();
    function commandOutput(relative, artifact) {
      if (!outputReads.has(relative)) {
        outputReads.set(
          relative,
          readFile(changeDir, relative, artifact, blockers)
        );
      }
      return outputReads.get(relative);
    }
    const receiptOutputsValid = receipt.execution.commands.every(
      (command, index) => {
      const stdoutArtifact = `${entry.receipt_path}:stdout:${index + 1}`;
      const stderrArtifact = `${entry.receipt_path}:stderr:${index + 1}`;
      const stdout = commandOutput(
        command.stdout_path,
        stdoutArtifact
      );
      const stderr = commandOutput(
        command.stderr_path,
        stderrArtifact
      );
      commandOutputs.set(
        execution?.commands?.[index]?.id || `command-${index + 1}`,
        stdout
      );
      return stdout !== null
        && stderr !== null
        && sha256(stdout) === command.stdout_sha256
        && sha256(stderr) === command.stderr_sha256;
      }
    );
    const executionOutputsValid = execution
      && execution.commands.every((command, index) => {
        const stdout = commandOutput(
          command.stdout_path,
          `${receipt.execution_envelope_path}:stdout:${index + 1}`
        );
        const stderr = commandOutput(
          command.stderr_path,
          `${receipt.execution_envelope_path}:stderr:${index + 1}`
        );
        return stdout !== null
          && stderr !== null
          && sha256(stdout) === command.stdout_sha256
          && sha256(stderr) === command.stderr_sha256;
      });
    const commandsValid = receiptOutputsValid
      && executionOutputsValid
      && canonicalJson(receipt.execution.commands)
        === canonicalJson(execution.commands.map((command) => ({
          argv: command.argv,
          exit_status: command.exit_status,
          stdout_sha256: command.stdout_sha256,
          stderr_sha256: command.stderr_sha256,
          stdout_path: command.stdout_path,
          stderr_path: command.stderr_path
        })))
      && commandPlanValid(
        host,
        execution.commands,
        receipt,
        lockedRepository,
        execution,
        commandOutputs,
        runtimeAuthority,
        lock,
        checkoutRoots,
        expectedRunnerIdentitySha256,
        expectedRunnerSourceSha256,
        expectedFixtureManifestSha256,
        expectedSourceInventory,
        commandPlanDiagnostics
      );
    const checksValid = canonicalJson(
      receipt.checks.map((check) => check.id).sort()
    ) === canonicalJson([
      'host-smoke',
      'plugin-discovery',
      'remote-commit-reachability',
      'runtime-doctor'
    ]);
    if (!commandsValid) {
      blockers.push(blocker(
        `verification-release:install-command-evidence-mismatch:${host}`,
        entry.receipt_path,
        commandPlanDiagnostics
      ));
    }
    const valid = receipt.host === host
      && receipt.change_id === bindings.change_id
      && receipt.release_gate_id === bindings.release_gate_id
      && receipt.archive_gate_id === bindings.archive_gate_id
      && receipt.gate_input_sha256 === bindings.gate_input_sha256
      && receipt.evidence_index_digest === bindings.evidence_index_digest
      && receipt.host_lock_sha256 === pointer.host_lock_sha256
      && receipt.runtime_authority_digest === runtimeAuthority?.digest
      && receipt.commit === entry.commit
      && receipt.commit === lockedRepository?.commit
      && receipt.repository === lockedRepository?.repository
      && receipt.ref === lockedRepository?.ref
      && receipt.plugin_realpath === path.join(
        receipt.checkout_realpath,
        lockedRepository?.plugin_path || ''
      )
      && receipt.runner_identity_sha256 === execution?.runner_identity_sha256
      && receipt.runner_source_sha256 === execution?.runner_source_sha256
      && receipt.source_snapshot_digest === execution?.source_snapshot_digest
      && receipt.fixture_snapshot_digest === execution?.fixture_snapshot_digest
      && receipt.fixture_manifest_sha256 === execution?.fixture_manifest_sha256
      && execution?.status === 'passed'
      && execution?.blocker === null
      && execution?.host === host
      && execution?.change_id === bindings.change_id
      && execution?.run_id === pointer.run_id
      && execution?.repository === lockedRepository?.repository
      && execution?.ref === lockedRepository?.ref
      && execution?.commit === lockedRepository?.commit
      && execution?.host_lock_sha256 === pointer.host_lock_sha256
      && execution?.release_gate_id === bindings.release_gate_id
      && execution?.archive_gate_id === bindings.archive_gate_id
      && execution?.gate_input_sha256 === bindings.gate_input_sha256
      && execution?.evidence_index_digest === bindings.evidence_index_digest
      && execution?.runtime_authority_digest === runtimeAuthority?.digest
      && receipt.execution.environment_sha256 === execution?.environment_sha256
      && commandsValid
      && checksValid;
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
      receipt_sha256: actualHash,
      repository: receipt.repository,
      snapshot_digest: receipt.source_snapshot_digest,
      fixture_snapshot_digest: receipt.fixture_snapshot_digest,
      fixture_manifest_sha256: receipt.fixture_manifest_sha256,
      host_authority_digest: execution?.host_authority_digest || null,
      execution_envelope_id: envelopeRead.value?.id || null
    });
  }
  if (effectiveIndex.hosts.some(
    (entry) => !REQUIRED_HOSTS.includes(entry?.host)
  )) {
    blockers.push(blocker(
      'verification-release:host-installation-unknown-host',
      artifact
    ));
  }
  const fixtureDigests = new Set(
    records.map((entry) => entry.fixture_snapshot_digest)
  );
  const fixtureManifestDigests = new Set(
    records.map((entry) => entry.fixture_manifest_sha256)
  );
  if (
    records.length === REQUIRED_HOSTS.length
    && fixtureDigests.size !== 1
  ) {
    blockers.push(blocker(
      'verification-release:fixture-snapshot-mismatch',
      artifact,
      Object.fromEntries(records.map((entry) => [
        entry.host,
        entry.fixture_snapshot_digest
      ]))
    ));
  }
  if (
    records.length === REQUIRED_HOSTS.length
    && (
      fixtureManifestDigests.size !== 1
      || !fixtureManifestDigests.has(expectedFixtureManifestSha256)
    )
  ) {
    blockers.push(blocker(
      'verification-release:fixture-manifest-mismatch',
      artifact,
      Object.fromEntries(records.map((entry) => [
        entry.host,
        entry.fixture_manifest_sha256
      ]))
    ));
  }
  return records.sort((left, right) => left.host.localeCompare(right.host));
}

function validateCompatibility(
  schemaRegistry,
  candidate,
  input,
  hosts,
  bindings,
  pointer,
  lock,
  blockers
) {
  const artifact = pointer.compatibility.path;
  const validated = validateSchema(
    schemaRegistry,
    'cross-host-release-result',
    candidate,
    artifact,
    blockers
  );
  if (!validated) {
    blockers.push(blocker(
      'verification-release:cross-host-compatibility-blocked',
      artifact
    ));
    return null;
  }
  const commits = new Map(hosts.map((entry) => [entry.host, entry.commit]));
  const receipts = new Map(
    hosts.map((entry) => [entry.host, entry.receipt_sha256])
  );
  const candidateHostIds = validated.hosts.map((entry) => entry.host);
  const validHosts = validated.hosts.length === REQUIRED_HOSTS.length
    && new Set(candidateHostIds).size === REQUIRED_HOSTS.length
    && REQUIRED_HOSTS.every((host) => candidateHostIds.includes(host))
    && validated.hosts.every((entry) => (
      REQUIRED_HOSTS.includes(entry.host)
      && commits.get(entry.host) === entry.commit
      && receipts.get(entry.host) === entry.receipt_sha256
      && hosts.find((host) => host.host === entry.host)?.snapshot_digest
        === entry.snapshot_digest
    ));
  const commitsObject = Object.fromEntries(hosts.map((entry) => [
    entry.host,
    entry.commit
  ]));
  const repositoriesObject = Object.fromEntries(hosts.map((entry) => [
    entry.host,
    entry.repository
  ]));
  const snapshotsObject = Object.fromEntries(hosts.map((entry) => [
    entry.host,
    entry.snapshot_digest
  ]));
  const reconstructedAuthority = {
    lock_sha256: pointer.host_lock_sha256,
    commits: commitsObject,
    repositories: repositoriesObject,
    heads: commitsObject,
    snapshots: snapshotsObject,
    comparison: validated.comparison_digest
  };
  const authorityDigest = sha256(canonicalJson(reconstructedAuthority));
  const signedAuthorityDigests = new Set(
    hosts.map((entry) => entry.host_authority_digest)
  );
  if (
    validated.change_id !== input.change_id
    || validated.release_gate_id !== bindings.release_gate_id
    || validated.archive_gate_id !== bindings.archive_gate_id
    || validated.gate_input_sha256 !== bindings.gate_input_sha256
    || validated.evidence_index_digest !== bindings.evidence_index_digest
    || validated.host_lock_sha256 !== pointer.host_lock_sha256
    || validated.authority_digest !== authorityDigest
    || validated.kernel_version !== input.kernel_version
    || !validHosts
    || signedAuthorityDigests.size !== 1
    || !signedAuthorityDigests.has(validated.authority_digest)
    || canonicalJson(validated.blockers) !== canonicalJson([])
    || REQUIRED_HOSTS.some((host) => (
      hostRepositoryLock(lock, host)?.commit !== commits.get(host)
      || hostRepositoryLock(lock, host)?.repository
        !== repositoriesObject[host]
    ))
  ) {
    blockers.push(blocker(
      'verification-release:cross-host-compatibility-blocked',
      artifact,
      validated.blockers
    ));
  }
  return {
    ok: validated.ok === true,
    kernel_version: validated.kernel_version,
    hosts: validated.hosts,
    authority_summary: {
      ...reconstructedAuthority,
      digest: authorityDigest
    },
    sha256: sha256(Buffer.from(canonicalJson(validated)))
  };
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
  const runtimeAuthority = options.runtimeAuthority || null;
  const expectedHostRunnerSourceSha256 = options.expectedHostRunnerSourceSha256
    || hostProofRunnerSourceDigest(LOCAL_REPOSITORY_ROOT);
  const expectedFixtureManifestSha256 = options.expectedFixtureManifestSha256
    || managedFixtureManifestDigest(path.join(
      LOCAL_VERIFICATION_ROOT,
      'assets',
      'contract-fixtures'
    ));
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
    const selectedRuntimeAuthority = runtimeAuthority
      || kernel.createRuntimeAuthority({ projectRoot: root });
    const runtimeResolution = resolveRuntimeAuthority(
      runtimeStatusRead.value,
      selectedRuntimeAuthority,
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
    const pointerRead = readJson(
      changeDir,
      'operations/host-proof-current.json',
      'operations/host-proof-current.json',
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
    let hostBundle = null;
    let trustedFactAuthority = options.trustedFactAuthority || null;
    let canonicalRebuild = null;
    let currentFingerprints = null;
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
          currentFingerprints = fingerprintResolver(
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
      hostBundle = loadHostProofBundle(
        schemaRegistry,
        changeDir,
        pointerRead,
        change,
        runtimeResolution?.authority,
        blockers
      );
      if (hostBundle && trustedFactAuthority) {
        hosts = validateHostInstallations(
          schemaRegistry,
          trustedFactAuthority,
          changeDir,
          hostBundle.index.value,
          releaseBindings,
          hostBundle.pointer,
          hostBundle.lock.validated,
          runtimeResolution?.authority,
          expectedHostRunnerSourceSha256,
          expectedFixtureManifestSha256,
          currentFingerprints?.code_sha,
          blockers
        );
        compatibility = validateCompatibility(
          schemaRegistry,
          hostBundle.compatibility.value,
          input,
          hosts,
          releaseBindings,
          hostBundle.pointer,
          hostBundle.lock.validated,
          blockers
        );
        hostAuthorityResult = compatibility
          ? { summary: compatibility.authority_summary }
          : null;
      }
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
      host_proof_pointer: pointerRead.bytes ? sha256(pointerRead.bytes) : null,
      host_installations: hostBundle?.index?.bytes
        ? sha256(hostBundle.index.bytes)
        : null,
      cross_host_compatibility: hostBundle?.compatibility?.bytes
        ? sha256(hostBundle.compatibility.bytes)
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
  HOST_DESCRIPTORS,
  PROOF_SCHEMA,
  REQUIRED_HOSTS,
  REQUIRED_REPORTS,
  createReleaseProofValidator,
  resolveCurrentFingerprints
};
