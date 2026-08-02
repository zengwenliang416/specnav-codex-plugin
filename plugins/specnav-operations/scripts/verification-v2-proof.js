#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./plugin-runtime');

const kernel = runtime.requirePluginScript('specnav-verification', 'kernel');
const core = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

const REQUIRED_HOSTS = Object.freeze(['claude-code', 'codex', 'codefree-o']);
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

function readFile(base, relative, artifact, blockers) {
  let file;
  try {
    file = pathInside(base, relative, artifact);
  } catch (error) {
    blockers.push(blocker(error.message, artifact));
    return null;
  }
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      blockers.push(blocker(`verification-release:artifact-not-file:${artifact}`, artifact));
      return null;
    }
    return fs.readFileSync(file);
  } catch (error) {
    blockers.push(blocker(
      error && error.code === 'ENOENT'
        ? `verification-release:artifact-missing:${artifact}`
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

function automaticSchemaRegistry(changeDir, blockers) {
  const parsed = readJson(
    changeDir,
    'verify/v2/runtime-status.json',
    'verify/v2/runtime-status.json',
    blockers
  );
  if (!parsed.value) return null;
  try {
    return kernel.createSchemaRegistry({
      runtimeStatus: parsed.value,
      runtimeRoot: parsed.value.runtime_root
    });
  } catch (error) {
    blockers.push(blocker(
      'verification-release:runtime-schema-registry-unavailable',
      'verify/v2/runtime-status.json',
      error instanceof Error ? error.message : String(error)
    ));
    return null;
  }
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
    || input.open_failure_ids.length > 0
  ) {
    blockers.push(blocker(
      `verification-release:kernel-gate-not-pass:${stage}`,
      artifact,
      validated.blockers
    ));
  }
  return validated;
}

function validateApproval(
  schemaRegistry,
  snapshotCandidate,
  approvalCandidate,
  input,
  blockers
) {
  const snapshot = validateSchema(
    schemaRegistry,
    'case-snapshot',
    snapshotCandidate,
    'verify/v2/case-snapshot.json',
    blockers
  );
  const approval = validateSchema(
    schemaRegistry,
    'case-approval',
    approvalCandidate,
    'verify/v2/case-approval.json',
    blockers
  );
  if (!snapshot || !approval) return { snapshot, approval };
  const caseIds = snapshot.cases.map((entry) => entry.id);
  const aggregationCaseIds = input?.aggregation_request?.case_ids;
  const valid = approval.decision === 'approved'
    && approval.reviewer?.kind === 'human'
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
  if (model.change_id !== input.change_id || model.verdict !== 'green') {
    blockers.push(blocker('verification-release:report-not-green', artifact));
  }
  if (model.sources.gate_decision_id !== releaseGate.id) {
    blockers.push(blocker('verification-release:report-gate-mismatch', artifact));
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
  if (
    model.summary.integrity !== 'intact'
    || model.summary.freshness?.status !== 'fresh'
    || model.summary.repair_loop?.status !== 'closed'
    || model.summary.open_failure_ids.length > 0
    || model.summary.open_repair_ids.length > 0
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
  if (
    index.change_id !== input.change_id
    || index.source_raw !== 'raw.jsonl'
    || index.source_digest !== sha256(rawBytes)
    || index.index_version !== input.evidence_index_version
    || index.record_count !== index.entries.length
    || !sameIds(index.entries.map((entry) => entry.id), inputEvidenceIds)
  ) {
    blockers.push(blocker(
      'verification-release:evidence-index-binding-mismatch',
      artifact
    ));
  }
  return index;
}

function validateReports(changeDir, blockers) {
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
    reports.push({
      name,
      path: relative,
      sha256: sha256(bytes),
      size: bytes.length
    });
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

function validateHostInstallations(changeDir, index, blockers) {
  const artifact = 'operations/host-installation-receipts.json';
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
      && receipt.commit === entry.commit
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

function validateCompatibility(candidate, input, hosts, blockers) {
  const artifact = 'operations/cross-host-compatibility.json';
  const commits = new Map(hosts.map((entry) => [entry.host, entry.commit]));
  const validHosts = Array.isArray(candidate?.hosts)
    && candidate.hosts.length === REQUIRED_HOSTS.length
    && candidate.hosts.every((entry) => (
      REQUIRED_HOSTS.includes(entry?.host)
      && commits.get(entry.host) === entry.commit
    ));
  if (
    !candidate
    || candidate.schema !== 'specnav.verification.cross-host-release-result.v1'
    || candidate.change_id !== input.change_id
    || candidate.ok !== true
    || candidate.kernel_version !== input.kernel_version
    || !validHosts
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

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('verification-release:proof-path-symlink');
  }
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600
  });
  fs.renameSync(temporary, file);
}

function createReleaseProofValidator(options = {}) {
  const clock = options.clock || (() => new Date().toISOString());
  if (typeof clock !== 'function') {
    throw new Error('verification-release:clock-invalid');
  }

  function validate(projectRoot, changeId = null) {
    const root = path.resolve(projectRoot);
    const change = changeId || core.activeChange(root);
    const blockers = [];
    if (!change) {
      return {
        ok: false,
        change_id: null,
        proof: null,
        blockers: [blocker('verification-release:active-change-missing')]
      };
    }
    const changeDir = path.join(root, 'openspec', 'changes', change);
    if (!fs.existsSync(changeDir)) {
      return {
        ok: false,
        change_id: change,
        proof: null,
        blockers: [blocker(
          'verification-release:change-missing',
          `openspec/changes/${change}`
        )]
      };
    }
    const schemaRegistry = options.schemaRegistry
      || automaticSchemaRegistry(changeDir, blockers);
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
    if (
      !input
      || input.schema !== 'specnav.verification.release-gate-input.v1'
      || input.change_id !== change
      || !isRecord(input.aggregation_request)
      || !Array.isArray(input.open_failure_ids)
      || !isRecord(input.freshness)
    ) {
      blockers.push(blocker(
        'verification-release:gate-input-invalid',
        'verify/v2/gate-input.json'
      ));
    }
    if (input?.lane === 'light') {
      blockers.push(blocker(
        'verification-release:light-mode-not-supported',
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

    let approval = { snapshot: null, approval: null };
    let releaseGate = null;
    let archiveGate = null;
    let model = null;
    let evidenceIndex = null;
    let migration = { required: null, receipt: null };
    let hosts = [];
    let compatibility = null;
    if (input) {
      approval = validateApproval(
        schemaRegistry,
        snapshotRead.value,
        approvalRead.value,
        input,
        blockers
      );
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
      hosts = validateHostInstallations(
        changeDir,
        installRead.value,
        blockers
      );
      compatibility = validateCompatibility(
        compatibilityRead.value,
        input,
        hosts,
        blockers
      );
    }
    const reports = validateReports(changeDir, blockers);
    const finalBlockers = stableBlockers(blockers);
    const generatedAt = clock();
    const sources = {
      gate_input: inputRead.bytes ? sha256(inputRead.bytes) : null,
      case_snapshot: snapshotRead.bytes ? sha256(snapshotRead.bytes) : null,
      case_approval: approvalRead.bytes ? sha256(approvalRead.bytes) : null,
      release_gate: releaseRead.bytes ? sha256(releaseRead.bytes) : null,
      archive_gate: archiveRead.bytes ? sha256(archiveRead.bytes) : null,
      report_model: reportRead.bytes ? sha256(reportRead.bytes) : null,
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
      release_gate: releaseGate ? {
        id: releaseGate.id,
        decision: releaseGate.decision,
        source_case_ids: releaseGate.source_case_ids,
        source_reading_ids: releaseGate.source_reading_ids,
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
        path.join(changeDir, 'operations', 'verification-v2-proof.json'),
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
