#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const kernel = require('../../../plugins/specnav-verification/kernel');
const {
  loadRuntimeLock
} = require('../../../plugins/specnav-verification/kernel/runtime/lock-manifest');
const {
  doctorRuntime
} = require('../../../plugins/specnav-verification/kernel/runtime/doctor');
const {
  runtimeBaseDefault
} = require('../../../plugins/specnav-verification/kernel/runtime/installer');
const { readySchemaRegistry } = require('../contracts/cross-reference/test-helpers');
const { reportModel } = require('../reports/report-test-helpers');

const HOSTS = Object.freeze(['claude-code', 'codex', 'codefree-o']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function testCase(change, caseId) {
  return {
    schema: 'specnav.verification.test-case.v1',
    id: caseId,
    change_id: change,
    requirement_ids: ['REQ-1'],
    acceptance_ids: ['AC-1'],
    title: 'Operations release proof',
    goal: 'Prove the complete six-domain release and archive contract.',
    actor: 'release-owner',
    priority: 'P0',
    preconditions: [],
    steps: [{
      id: 'step-1',
      action: 'Run the release proof fixture.',
      expected: 'All six domains produce deterministic readings.',
      assertion_ids: ['assertion-1']
    }],
    assertions: [{
      id: 'assertion-1',
      statement: 'The fixture returns a complete proof.',
      expected: true,
      oracle: {
        type: 'structured_comparison',
        human_signoff_allowed: false
      },
      evidence_kinds: ['structured_comparison']
    }],
    domains: Object.fromEntries(kernel.SIX_DOMAINS.map((domain) => [
      domain,
      {
        mode: 'required',
        assertion_ids: ['assertion-1'],
        runner: 'command'
      }
    ])),
    runner: {
      kind: 'command',
      timeout_ms: 1000,
      entrypoint: 'node',
      args: ['fixture.js'],
      cwd: '.',
      env_keys: [],
      requires_midscene: false
    },
    evidence_policy: {
      allowed_kinds: ['structured_comparison'],
      required_kinds: ['structured_comparison'],
      retain_on_failure: true,
      content_addressed: true
    },
    status: 'ready',
    created_at: '2026-08-02T00:00:00Z'
  };
}

function reading(change, caseId, domain) {
  return {
    schema: 'specnav.verification.reading.v1',
    id: `reading-${domain}`,
    change_id: change,
    run_id: 'run-release',
    case_id: caseId,
    attempt_id: 'attempt-release',
    step_id: 'step-1',
    assertion_id: 'assertion-1',
    domain,
    expected: true,
    actual: true,
    oracle: {
      type: 'structured_comparison',
      owner: 'command-runner',
      deterministic: true
    },
    evidence_ids: [`evidence-${domain}`],
    verdict: 'pass',
    recorded_at: '2026-08-02T00:00:02Z',
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(40)
  };
}

function evidence(change, caseId, source) {
  return {
    schema: 'specnav.verification.evidence.v1',
    id: source.evidence_ids[0],
    kind: 'structured_comparison',
    path: `objects/${source.evidence_ids[0]}.json`,
    sha256: '3'.repeat(64),
    size: 42,
    producer: 'command-runner',
    captured_at: '2026-08-02T00:00:01Z',
    change_id: change,
    run_id: source.run_id,
    case_id: caseId,
    attempt_id: source.attempt_id,
    step_id: source.step_id,
    assertion_id: source.assertion_id,
    code_sha: source.code_sha,
    test_sha: source.test_sha,
    environment_hash: '4'.repeat(64),
    runtime_version: '2.0.0',
    kernel_version: kernel.metadata.version,
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    domain: source.domain
  };
}

function createGate(schemaRegistry, input, stage) {
  const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
  const engine = kernel.createDecisionEngine({
    schemaRegistry,
    aggregator,
    clock: () => '2026-08-02T00:00:04Z'
  });
  const result = engine.decide({
    change_id: input.change_id,
    stage,
    aggregation_request: input.aggregation_request,
    open_failure_ids: input.open_failure_ids,
    freshness: input.freshness,
    integrity_status: input.integrity_status,
    evidence_index_version: input.evidence_index_version,
    runtime_version: input.runtime_version,
    kernel_version: input.kernel_version,
    policy_version: input.policy_version
  });
  if (!result.ok) throw new Error(JSON.stringify(result.blockers));
  return result.gate;
}

function populateProject(projectRoot, change) {
  const root = path.resolve(projectRoot);
  const changeDir = path.join(root, 'openspec', 'changes', change);
  const verifyV2 = path.join(changeDir, 'verify', 'v2');
  const reportsDir = path.join(changeDir, 'verify', 'reports');
  const opsDir = path.join(changeDir, 'operations');
  const caseId = `case-${change}`;
  const snapshotId = `snapshot-${change}`;
  const approvalId = `approval-${change}`;
  const schemaRegistry = readySchemaRegistry();
  const lock = loadRuntimeLock();
  const runtimeStatus = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      kernel: {
        name: kernel.metadata.name,
        version: kernel.metadata.version,
        apiVersion: kernel.metadata.apiVersion,
        contractVersion: kernel.metadata.contractVersion,
        contractDigest: kernel.metadata.contractDigest
      }
    },
    providerEnvironment: {},
    requiresMidscene: false,
    runtimeBase: runtimeBaseDefault()
  });
  if (!runtimeStatus.ok) {
    throw new Error(JSON.stringify(runtimeStatus.blockers));
  }
  const readings = kernel.SIX_DOMAINS.map((domain) => (
    reading(change, caseId, domain)
  ));
  const evidenceEntries = readings.map((entry) => (
    evidence(change, caseId, entry)
  ));
  const input = {
    schema: 'specnav.verification.release-gate-input.v1',
    change_id: change,
    lane: 'standard',
    case_snapshot_id: snapshotId,
    case_snapshot_hash: 'a'.repeat(64),
    case_approval_id: approvalId,
    aggregation_request: {
      change_id: change,
      case_ids: [caseId],
      readings,
      evidence: evidenceEntries,
      integrity: {
        ok: true,
        facts: {
          summary: {
            evidence_count: evidenceEntries.length,
            integrity: 'intact',
            freshness: 'fresh'
          },
          evidence: evidenceEntries.map((entry) => ({
            evidence_id: entry.id,
            integrity: 'intact',
            freshness: 'fresh',
            exists: true,
            hash_match: true,
            size_match: true,
            producer_recognized: true,
            store_record_match: true,
            binding_match: true,
            path_safe: true
          }))
        },
        blockers: []
      },
      policy_facts: {
        not_applicable_decisions: [],
        terminal_states: []
      }
    },
    open_failure_ids: [],
    freshness: {
      status: 'fresh',
      checked_at: '2026-08-02T00:00:03Z',
      reasons: []
    },
    integrity_status: 'intact',
    evidence_index_version: evidenceEntries.length,
    runtime_version: '2.0.0',
    kernel_version: kernel.metadata.version,
    policy_version: 'verification-v2.0'
  };
  const releaseGate = createGate(schemaRegistry, input, 'release');
  const archiveGate = createGate(schemaRegistry, input, 'archive');
  const rawBytes = Buffer.from(
    `${evidenceEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  const evidenceIndex = {
    schema: 'specnav.verification.evidence-index.v1',
    index_version: input.evidence_index_version,
    change_id: change,
    generated_at: '2026-08-02T00:00:01Z',
    source_raw: 'raw.jsonl',
    source_digest: sha256(rawBytes),
    record_count: evidenceEntries.length,
    entries: evidenceEntries
  };
  const snapshot = {
    schema: 'specnav.verification.case-snapshot.v1',
    id: snapshotId,
    change_id: change,
    snapshot_hash: input.case_snapshot_hash,
    cases: [testCase(change, caseId)],
    created_at: '2026-08-02T00:00:00Z',
    created_by: { id: 'reviewer-release', kind: 'human' },
    requirements_hash: '5'.repeat(64),
    acceptance_hash: '6'.repeat(64)
  };
  const model = reportModel('green', {
    id: `report-model-${change}`,
    change_id: change,
    sources: {
      case_snapshot_id: snapshot.id,
      case_snapshot_hash: snapshot.snapshot_hash,
      run_ids: ['run-release'],
      attempt_ids: ['attempt-release'],
      reading_ids: readings.map((entry) => entry.id),
      evidence_ids: evidenceEntries.map((entry) => entry.id),
      evidence_index_version: input.evidence_index_version,
      evidence_index_digest: evidenceIndex.source_digest,
      aggregate_id: releaseGate.id.replace(/^gate-/, 'verification-aggregate-'),
      gate_decision_id: releaseGate.id
    },
    summary: {
      ...reportModel('green').summary,
      runtime_version: input.runtime_version,
      kernel_version: input.kernel_version
    }
  });

  writeJson(path.join(verifyV2, 'runtime-status.json'), runtimeStatus);
  writeJson(path.join(verifyV2, 'case-snapshot.json'), snapshot);
  writeJson(path.join(verifyV2, 'case-approval.json'), {
    schema: 'specnav.verification.case-approval.v1',
    id: approvalId,
    change_id: change,
    snapshot_id: snapshot.id,
    snapshot_hash: snapshot.snapshot_hash,
    decision: 'approved',
    reviewer: { id: 'reviewer-release', kind: 'human' },
    decided_at: '2026-08-02T00:00:01Z'
  });
  writeJson(path.join(verifyV2, 'gate-input.json'), input);
  writeJson(path.join(verifyV2, 'release-gate.json'), releaseGate);
  writeJson(path.join(verifyV2, 'archive-gate.json'), archiveGate);
  writeJson(path.join(verifyV2, 'report-model.json'), model);
  fs.mkdirSync(path.join(changeDir, 'verify', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'verify', 'evidence', 'raw.jsonl'), rawBytes);
  writeJson(path.join(changeDir, 'verify', 'evidence', 'index.json'), evidenceIndex);
  writeJson(path.join(verifyV2, 'migration-status.json'), {
    schema: 'specnav.verification.migration-status.v1',
    change_id: change,
    required: false,
    legacy_artifacts: [],
    source_inventory_digest: 'c'.repeat(64),
    scanned_at: '2026-08-02T00:00:00Z',
    fallback_used: false
  });
  for (const name of [
    'overview.html',
    'test-case-catalog.html',
    'test-case-results.html'
  ]) {
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportsDir, name),
      `<!doctype html><title>${name}</title>\n`
    );
  }

  const releaseBindings = {
    change_id: change,
    release_gate_id: releaseGate.id,
    archive_gate_id: archiveGate.id,
    gate_input_sha256: sha256(
      fs.readFileSync(path.join(verifyV2, 'gate-input.json'))
    ),
    evidence_index_digest: evidenceIndex.source_digest
  };
  const hosts = HOSTS.map((host, index) => {
    const receiptPath = `operations/install-receipts/${host}.json`;
    const receipt = {
      schema: 'specnav.verification.host-install-receipt.v1',
      host,
      ...releaseBindings,
      source: `https://github.com/example/specnav-${host}.git`,
      commit: String(index + 7).repeat(40),
      clean_checkout: true,
      plugin_discovered: true,
      runtime_ready: true,
      fixture_verification: 'pass',
      command: `verify ${host}`,
      exit_status: 0,
      attestation: 'system-executed',
      fallback_used: false,
      recorded_at: '2026-08-02T00:00:05Z'
    };
    const receiptFile = path.join(changeDir, receiptPath);
    writeJson(receiptFile, receipt);
    return {
      host,
      receipt_path: receiptPath,
      receipt_sha256: sha256(fs.readFileSync(receiptFile)),
      commit: receipt.commit
    };
  });
  writeJson(path.join(opsDir, 'host-installation-receipts.json'), {
    schema: 'specnav.verification.host-installation-index.v1',
    change_id: change,
    hosts,
    fallback_used: false
  });
  writeJson(path.join(opsDir, 'cross-host-compatibility.json'), {
    schema: 'specnav.verification.cross-host-release-result.v1',
    ...releaseBindings,
    ok: true,
    hosts: hosts.map((entry) => ({
      host: entry.host,
      commit: entry.commit
    })),
    kernel_version: input.kernel_version,
    blockers: [],
    fallback_used: false,
    recorded_at: '2026-08-02T00:00:06Z'
  });
}

if (require.main === module) {
  const [projectRoot, change] = process.argv.slice(2);
  if (!projectRoot || !change) {
    process.stderr.write('Usage: populate-project.js <project-root> <change>\n');
    process.exit(2);
  }
  populateProject(projectRoot, change);
}

module.exports = { populateProject };
