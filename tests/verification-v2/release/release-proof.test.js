'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SIX_DOMAINS,
  createDecisionEngine,
  createSixDomainAggregator
} = require('../../../plugins/specnav-verification/kernel');
const {
  createTrustedFactAuthority
} = require('../../../plugins/specnav-verification/kernel/repair');
const {
  createCasePlanner,
  createCaseSnapshotWriter
} = require('../../../plugins/specnav-verification/kernel/cases');
const {
  loadRuntimeLock
} = require('../../../plugins/specnav-verification/kernel/runtime/lock-manifest');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');
const {
  reportModel
} = require('../reports/report-test-helpers');
const {
  createReleaseProofValidator
} = require('../../../plugins/specnav-operations/scripts/verification-v2-proof');
const {
  writeArchiveGate
} = require('../../../plugins/specnav-operations/scripts/operations-gate');
const safeFs = require('../../../plugins/specnav-operations/scripts/safe-filesystem');
const {
  createHostAuthorityFixture
} = require('../cross-host/host-authority-test-helpers');

const CHANGE = 'release-proof-change';
const CASE_ID = 'case-release-proof';
const HOSTS = ['claude-code', 'codex', 'codefree-o'];
const RUNTIME_VERSION = loadRuntimeLock().runtime_version;
const TRUST_KEY = Buffer.alloc(32, 17);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function reidentifyGate(gate) {
  const semantic = {
    change_id: gate.change_id,
    stage: gate.stage,
    decision: gate.decision,
    source_case_ids: [...new Set(gate.source_case_ids)].sort(),
    source_reading_ids: [...new Set(gate.source_reading_ids)].sort(),
    failure_state_status: gate.failure_state_status,
    failure_state_digest: gate.failure_state_digest,
    authority_chain_digest: gate.authority_chain_digest,
    evidence_index_version: gate.evidence_index_version,
    runtime_version: gate.runtime_version,
    kernel_version: gate.kernel_version,
    freshness: gate.freshness,
    integrity_status: gate.integrity_status,
    policy_version: gate.policy_version,
    blockers: gate.blockers,
    warnings: gate.warnings
  };
  return {
    ...gate,
    id: `gate-${sha256(canonicalJson(semantic))}`
  };
}

function reidentifyReportModel(model) {
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
  return {
    ...model,
    id: `report-model-${sha256(canonicalJson(semantic))}`
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function reviewer() {
  return { id: 'reviewer-release', kind: 'human' };
}

function testCase() {
  return {
    schema: 'specnav.verification.test-case.v1',
    id: CASE_ID,
    change_id: CHANGE,
    requirement_ids: ['REQ-1'],
    acceptance_ids: ['AC-1'],
    title: 'Release proof case',
    goal: 'Prove the complete release and archive contract.',
    actor: 'release owner',
    priority: 'P0',
    preconditions: ['A clean managed fixture is available.'],
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
    domains: Object.fromEntries(SIX_DOMAINS.map((domain) => [
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

function reading(domain) {
  return {
    schema: 'specnav.verification.reading.v1',
    id: `reading-${domain}`,
    change_id: CHANGE,
    run_id: 'run-release',
    case_id: CASE_ID,
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

function evidence(source) {
  return {
    schema: 'specnav.verification.evidence.v1',
    id: source.evidence_ids[0],
    kind: 'structured_comparison',
    path: `objects/${source.evidence_ids[0]}.json`,
    sha256: '3'.repeat(64),
    size: 42,
    producer: 'command-runner',
    captured_at: '2026-08-02T00:00:01Z',
    change_id: CHANGE,
    run_id: source.run_id,
    case_id: CASE_ID,
    attempt_id: source.attempt_id,
    step_id: source.step_id,
    assertion_id: source.assertion_id,
    code_sha: source.code_sha,
    test_sha: source.test_sha,
    environment_hash: '4'.repeat(64),
    runtime_version: RUNTIME_VERSION,
    kernel_version: '2.0.0-alpha.2',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    domain: source.domain
  };
}

function aggregationRequest() {
  const readings = SIX_DOMAINS.map(reading);
  const evidenceEntries = readings.map(evidence).sort((left, right) => (
    left.captured_at.localeCompare(right.captured_at)
    || left.id.localeCompare(right.id)
  ));
  return {
    change_id: CHANGE,
    case_ids: [CASE_ID],
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
        })).sort((left, right) => (
          left.evidence_id.localeCompare(right.evidence_id)
        ))
      },
      blockers: []
    },
    policy_facts: {
      not_applicable_decisions: [],
      terminal_states: []
    }
  };
}

function gateInput() {
  const failureState = {
    ok: true,
    states: [],
    effective_failures: [],
    open_failure_ids: [],
    blockers: []
  };
  return {
    schema: 'specnav.verification.release-gate-input.v1',
    change_id: CHANGE,
    lane: 'full',
    case_snapshot_id: 'snapshot-release',
    case_snapshot_hash: 'a'.repeat(64),
    case_approval_id: 'approval-release',
    case_approval_reviewer_id: 'reviewer-release',
    aggregation_request: aggregationRequest(),
    open_failure_ids: [],
    failure_state_status: 'valid',
    failure_state_digest: sha256(canonicalJson(failureState)),
    authority_chain_digest: sha256(canonicalJson({
      transition_proposals: null,
      transition_receipts: null,
      attempt_facts: null
    })),
    freshness: {
      status: 'fresh',
      checked_at: '2026-08-02T00:00:03Z',
      reasons: []
    },
    integrity_status: 'intact',
    evidence_index_version: 7,
    runtime_version: RUNTIME_VERSION,
    kernel_version: '2.0.0-alpha.2',
    policy_version: 'verification-v2.0'
  };
}

function createGate(schemaRegistry, input, stage) {
  const aggregator = createSixDomainAggregator({ schemaRegistry });
  const engine = createDecisionEngine({
    schemaRegistry,
    aggregator,
    clock: () => '2026-08-02T00:00:04Z'
  });
  const result = engine.decide({
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
  });
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  return result.gate;
}

function makeProject(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-release-proof-'));
  const changeDir = path.join(root, 'openspec', 'changes', CHANGE);
  const verifyV2 = path.join(changeDir, 'verify', 'v2');
  const reportsDir = path.join(changeDir, 'verify', 'reports');
  const opsDir = path.join(changeDir, 'operations');
  fs.mkdirSync(path.join(root, 'openspec', '.specnav'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec', '.specnav', 'active-change'), `${CHANGE}\n`);
  fs.mkdirSync(verifyV2, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(opsDir, { recursive: true });

  const schemaRegistry = readySchemaRegistry();
  const trustedFactAuthority = createTrustedFactAuthority({
    schemaRegistry,
    key: TRUST_KEY,
    clock: () => '2026-08-02T00:00:03Z'
  });
  const requirements = [{
    id: 'REQ-1',
    statement: 'The release proof uses current approved requirements.'
  }];
  const acceptance = [{
    id: 'AC-1',
    statement: 'All six domains and release provenance pass.'
  }];
  const plan = createCasePlanner({ schemaRegistry }).plan({
    changeId: CHANGE,
    requirements,
    acceptance,
    cases: [testCase()]
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.blockers));
  const snapshotResult = createCaseSnapshotWriter({ schemaRegistry }).create({
    plan,
    createdAt: '2026-08-02T00:00:00Z',
    createdBy: reviewer()
  });
  assert.equal(snapshotResult.ok, true, JSON.stringify(snapshotResult.blockers));
  const snapshot = snapshotResult.snapshot;
  const input = gateInput();
  input.case_snapshot_id = snapshot.id;
  input.case_snapshot_hash = snapshot.snapshot_hash;
  const run = {
    schema: 'specnav.verification.run.v1',
    id: 'run-release',
    change_id: CHANGE,
    case_snapshot_id: snapshot.id,
    case_snapshot_hash: snapshot.snapshot_hash,
    case_ids: [CASE_ID],
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(40),
    environment_hash: '4'.repeat(64),
    runtime_version: input.runtime_version,
    kernel_version: input.kernel_version,
    status: 'passed',
    created_at: '2026-08-02T00:00:01Z',
    started_at: '2026-08-02T00:00:01Z',
    completed_at: '2026-08-02T00:00:02Z',
    kind: 'initial',
    origin_run_id: null,
    parent_run_id: null,
    parent_attempt_id: null,
    failure_id: null
  };
  const attempt = {
    schema: 'specnav.verification.attempt.v1',
    id: 'attempt-release',
    run_id: run.id,
    change_id: CHANGE,
    case_id: CASE_ID,
    case_snapshot_hash: snapshot.snapshot_hash,
    kind: 'initial',
    sequence: 1,
    runner: 'command',
    code_sha: run.code_sha,
    test_sha: run.test_sha,
    scenario_hash: '5'.repeat(64),
    environment_hash: run.environment_hash,
    browser_project: 'none',
    test_data_snapshot: '6'.repeat(64),
    runtime_version: run.runtime_version,
    kernel_version: run.kernel_version,
    status: 'passed',
    started_at: run.started_at,
    completed_at: run.completed_at,
    exit_status: 0,
    parent_attempt_id: null
  };
  const failureState = {
    ok: true,
    states: [],
    effective_failures: [],
    open_failure_ids: [],
    blockers: []
  };
  const authorityHeads = {
    transition_proposals: {
      kind: 'transition_proposal',
      path: 'v2/transition-proposals.jsonl',
      sequence: 0,
      latest_digest: null,
      terminal_envelope_id: null
    },
    transition_receipts: {
      kind: 'transition_application',
      path: 'v2/transition-receipts.jsonl',
      sequence: 0,
      latest_digest: null,
      terminal_envelope_id: null
    },
    attempt_facts: {
      kind: 'attempt_fact',
      path: 'v2/attempt-facts.jsonl',
      sequence: 0,
      latest_digest: null,
      terminal_envelope_id: null
    }
  };
  const authorityAnchor = trustedFactAuthority.sealChainAnchor({
    change_id: CHANGE,
    logs: authorityHeads,
    anchored_at: input.freshness.checked_at
  });
  input.authority_chain_digest = sha256(canonicalJson({
    anchor_id: authorityAnchor.id,
    logs: authorityHeads
  }));
  const freshness = {
    ok: true,
    checked_at: input.freshness.checked_at,
    summary: {
      status: 'fresh',
      total: 1,
      fresh: 1,
      stale: 0,
      unknown: 0
    },
    cases: [{
      case_id: CASE_ID,
      attempt_id: attempt.id,
      checked_at: input.freshness.checked_at,
      status: 'fresh',
      reasons: []
    }],
    blockers: []
  };
  const releaseGate = createGate(schemaRegistry, input, 'release');
  const archiveGate = createGate(schemaRegistry, input, 'archive');
  const aggregate = createSixDomainAggregator({ schemaRegistry })
    .aggregate(input.aggregation_request);
  const rawBytes = Buffer.from(
    `${input.aggregation_request.evidence.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  const evidenceIndex = {
    schema: 'specnav.verification.evidence-index.v1',
    index_version: input.evidence_index_version,
    change_id: CHANGE,
    generated_at: '2026-08-02T00:00:01Z',
    source_raw: 'raw.jsonl',
    source_digest: sha256(rawBytes),
    record_count: input.aggregation_request.evidence.length,
    entries: input.aggregation_request.evidence
  };
  const approval = {
    schema: 'specnav.verification.case-approval.v1',
    id: input.case_approval_id,
    change_id: CHANGE,
    snapshot_id: snapshot.id,
    snapshot_hash: snapshot.snapshot_hash,
    decision: 'approved',
    reviewer: reviewer(),
    decided_at: '2026-08-02T00:00:01Z'
  };
  const readingIds = input.aggregation_request.readings.map((entry) => entry.id);
  const model = reidentifyReportModel(reportModel('green', {
    id: 'report-model-release',
    change_id: CHANGE,
    sources: {
      case_snapshot_id: snapshot.id,
      case_snapshot_hash: snapshot.snapshot_hash,
      run_ids: ['run-release'],
      attempt_ids: ['attempt-release'],
      reading_ids: readingIds,
      evidence_ids: input.aggregation_request.evidence.map((entry) => entry.id),
      evidence_index_version: input.evidence_index_version,
      evidence_index_digest: evidenceIndex.source_digest,
      aggregate_id: aggregate.id,
      gate_decision_id: releaseGate.id
    },
    summary: {
      ...reportModel('green').summary,
      repair_loop: {
        status: 'not_started',
        failure_ids: [],
        repair_ids: [],
        history_event_count: 0
      },
      runtime_version: input.runtime_version,
      kernel_version: input.kernel_version
    }
  }));

  writeJson(path.join(verifyV2, 'case-snapshot.json'), snapshot);
  writeJson(path.join(verifyV2, 'case-approval.json'), approval);
  writeJson(path.join(verifyV2, 'requirements-source.json'), requirements);
  writeJson(path.join(verifyV2, 'acceptance-source.json'), acceptance);
  const runtimeStatus = {
    schema: 'specnav.verification.runtime-status.v1',
    ok: true,
    readiness: 'ready',
    runtime_version: RUNTIME_VERSION,
    runtime_root: schemaRegistry.runtime_root,
    checks: {
      lock: { ok: true },
      runtime: { ok: true, root: schemaRegistry.runtime_root },
      receipt: { ok: true, path: path.join(
        schemaRegistry.runtime_root,
        'install-receipt.json'
      ) },
      permissions: [],
      packages: [],
      browsers: [],
      provider: {
        configured: false,
        model_name_present: false,
        model_family_present: false,
        credential_source: null,
        base_url_present: false,
        secret_values_exposed: false
      }
    },
    blockers: [],
    warnings: [],
    actions: [],
    fallback_used: false
  };
  writeJson(path.join(verifyV2, 'runtime-status.json'), runtimeStatus);
  writeJson(path.join(verifyV2, 'runs.json'), [run]);
  writeJson(path.join(verifyV2, 'attempts.json'), [attempt]);
  writeJson(
    path.join(verifyV2, 'readings.json'),
    input.aggregation_request.readings
  );
  writeJson(path.join(verifyV2, 'failures.json'), []);
  writeJson(path.join(verifyV2, 'repair-links.json'), []);
  writeJson(path.join(verifyV2, 'freshness.json'), freshness);
  writeJson(
    path.join(verifyV2, 'integrity.json'),
    input.aggregation_request.integrity
  );
  writeJson(path.join(verifyV2, 'failure-state.json'), failureState);
  writeJson(
    path.join(verifyV2, 'authority-chain-anchor.json'),
    authorityAnchor
  );
  for (const name of [
    'transition-proposals.jsonl',
    'transition-receipts.jsonl',
    'attempt-facts.jsonl'
  ]) {
    fs.writeFileSync(path.join(verifyV2, name), '');
  }
  const runDir = path.join(changeDir, 'verify', 'runs', run.id);
  writeJson(
    path.join(runDir, 'attempts', attempt.id, 'integrity.json'),
    input.aggregation_request.integrity
  );
  writeJson(
    path.join(runDir, 'integrity.json'),
    input.aggregation_request.integrity
  );
  fs.writeFileSync(path.join(runDir, 'failures.jsonl'), '');
  writeJson(path.join(verifyV2, 'gate-input.json'), input);
  writeJson(path.join(verifyV2, 'release-gate.json'), releaseGate);
  writeJson(path.join(verifyV2, 'archive-gate.json'), archiveGate);
  writeJson(path.join(verifyV2, 'report-model.json'), model);
  fs.mkdirSync(path.join(changeDir, 'verify', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'verify', 'evidence', 'raw.jsonl'), rawBytes);
  writeJson(path.join(changeDir, 'verify', 'evidence', 'index.json'), evidenceIndex);
  writeJson(path.join(verifyV2, 'migration-status.json'), {
    schema: 'specnav.verification.migration-status.v1',
    change_id: CHANGE,
    required: false,
    legacy_artifacts: [],
    source_inventory_digest: 'c'.repeat(64),
    scanned_at: '2026-08-02T00:00:00Z',
    fallback_used: false
  });
  const renderedReports = [];
  for (const name of [
    'overview.html',
    'test-case-catalog.html',
    'test-case-results.html'
  ]) {
    const bytes = Buffer.from(`<!doctype html><title>${name}</title>\n`);
    fs.writeFileSync(path.join(reportsDir, name), bytes);
    renderedReports.push({
      name,
      path: `verify/reports/${name}`,
      sha256: sha256(bytes),
      size: bytes.length
    });
  }
  writeJson(path.join(verifyV2, 'report-render-manifest.json'), {
    schema: 'specnav.verification.report-render-manifest.v1',
    change_id: CHANGE,
    report_model_id: model.id,
    generated_at: '2026-08-02T00:00:05Z',
    reports: renderedReports
  });

  const releaseBindings = {
    change_id: CHANGE,
    release_gate_id: releaseGate.id,
    archive_gate_id: archiveGate.id,
    gate_input_sha256: sha256(
      fs.readFileSync(path.join(verifyV2, 'gate-input.json'))
    ),
    evidence_index_digest: evidenceIndex.source_digest
  };
  const configuredCommits = options.hostCommits || Object.fromEntries(
    HOSTS.map((host, index) => [host, String(index + 7).repeat(40)])
  );
  const records = HOSTS.map((host) => {
    const receiptPath = path.join('operations', 'install-receipts', `${host}.json`);
    const receipt = {
      schema: 'specnav.verification.host-install-receipt.v1',
      host,
      ...releaseBindings,
      source: `https://github.com/example/specnav-${host}.git`,
      commit: configuredCommits[host],
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
    const absolute = path.join(changeDir, receiptPath);
    writeJson(absolute, receipt);
    return {
      host,
      receipt_path: receiptPath,
      receipt_sha256: sha256(fs.readFileSync(absolute)),
      commit: receipt.commit
    };
  });
  writeJson(path.join(opsDir, 'host-installation-receipts.json'), {
    schema: 'specnav.verification.host-installation-index.v1',
    change_id: CHANGE,
    hosts: records,
    fallback_used: false
  });
  writeJson(path.join(opsDir, 'cross-host-compatibility.json'), {
    schema: 'specnav.verification.cross-host-release-result.v1',
    ...releaseBindings,
    ok: true,
    hosts: records.map((entry) => ({
      host: entry.host,
      commit: entry.commit
    })),
    kernel_version: input.kernel_version,
    blockers: [],
    fallback_used: false,
    recorded_at: '2026-08-02T00:00:06Z'
  });

  const commits = Object.fromEntries(records.map((entry) => [
    entry.host,
    entry.commit
  ]));
  const defaultHostCompatibilityAuthority = {
    resolve() {
      return options.hostAuthorityResult || {
        ok: true,
        commits,
        comparison: {
          ok: true,
          blockers: []
        },
        summary: {
          digest: 'd'.repeat(64),
          lock_sha256: 'e'.repeat(64),
          commits,
          heads: commits,
          snapshots: Object.fromEntries(HOSTS.map((host) => [
            host,
            'f'.repeat(64)
          ])),
          comparison: 'a'.repeat(64)
        },
        blockers: []
      };
    }
  };
  const hostCompatibilityAuthority = options.hostCompatibilityAuthority
    || defaultHostCompatibilityAuthority;
  const runtimeAuthority = {
    resolve(candidate) {
      return options.runtimeAuthorityResult || {
        ok: true,
        runtimeRoot: schemaRegistry.runtime_root,
        runtimeStatus: candidate,
        authority: {
          schema: 'specnav.verification.runtime-authority.v1',
          digest: 'b'.repeat(64),
          runtime_version: RUNTIME_VERSION,
          runtime_root: schemaRegistry.runtime_root
        },
        signingKey: TRUST_KEY,
        blockers: []
      };
    }
  };
  const validatorOptions = {
    schemaRegistry,
    runtimeAuthority,
    fingerprints: options.fingerprints || (() => ({
      case_snapshot_hash: snapshot.snapshot_hash,
      code_sha: run.code_sha,
      test_sha: run.test_sha,
      environment_hash: run.environment_hash,
      runtime_version: run.runtime_version,
      kernel_version: run.kernel_version
    })),
    hostCompatibilityAuthority,
    clock: () => '2026-08-02T00:00:07Z'
  };
  if (options.useRuntimeTrustedAuthority !== true) {
    validatorOptions.trustedFactAuthority = trustedFactAuthority;
  }
  return {
    root,
    changeDir,
    verifyV2,
    reportsDir,
    opsDir,
    schemaRegistry,
    validator: createReleaseProofValidator(validatorOptions)
  };
}

function blockers(result) {
  return new Set(result.blockers.map((entry) => entry.id));
}

test('complete Kernel-derived release and archive proof passes and writes digests', () => {
  const fixture = makeProject();
  assert.equal(
    readJson(path.join(fixture.verifyV2, 'report-model.json'))
      .summary.repair_loop.status,
    'not_started'
  );
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.proof.release_gate.decision, 'pass');
  assert.equal(result.proof.archive_gate.decision, 'pass');
  assert.deepEqual(
    result.proof.hosts.map((entry) => entry.host),
    [...HOSTS].sort()
  );
  assert.equal(result.proof.reports.length, 3);
  assert.equal(result.proof.fallback_used, false);
  assert.equal(
    fs.existsSync(path.join(fixture.opsDir, 'verification-v2-proof.json')),
    true
  );
});

test('no-failure release proof rejects a forged closed repair state', () => {
  const fixture = makeProject();
  const modelPath = path.join(fixture.verifyV2, 'report-model.json');
  const manifestPath = path.join(
    fixture.verifyV2,
    'report-render-manifest.json'
  );
  const model = readJson(modelPath);
  model.summary.repair_loop.status = 'closed';
  const identified = reidentifyReportModel(model);
  writeJson(modelPath, identified);
  const manifest = readJson(manifestPath);
  manifest.report_model_id = identified.id;
  writeJson(manifestPath, manifest);

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:report-state-not-closed'),
    true
  );
});

test('managed runtime signing key supplies the trusted fact authority by default', () => {
  const fixture = makeProject({ useRuntimeTrustedAuthority: true });

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(
    blockers(result).has(
      'verification-release:trusted-fact-authority-unavailable'
    ),
    false
  );
});

test('missing or non-human case approval blocks release', () => {
  const fixture = makeProject();
  const approvalPath = path.join(fixture.verifyV2, 'case-approval.json');
  const approval = readJson(approvalPath);
  approval.reviewer.kind = 'service';
  writeJson(approvalPath, approval);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(blockers(result).has('verification-release:case-approval-invalid'), true);
});

test('reviewer source hashes and approval time are revalidated by the Kernel authority', () => {
  for (const mutation of ['reviewer', 'requirements', 'time']) {
    const fixture = makeProject();
    if (mutation === 'reviewer') {
      const inputPath = path.join(fixture.verifyV2, 'gate-input.json');
      const input = readJson(inputPath);
      input.case_approval_reviewer_id = 'reviewer-forged';
      writeJson(inputPath, input);
    } else if (mutation === 'requirements') {
      writeJson(
        path.join(fixture.verifyV2, 'requirements-source.json'),
        [{ id: 'REQ-1', statement: 'Tampered after approval.' }]
      );
    } else {
      const approvalPath = path.join(fixture.verifyV2, 'case-approval.json');
      const approval = readJson(approvalPath);
      approval.decided_at = '2026-07-31T23:59:59Z';
      writeJson(approvalPath, approval);
    }
    const result = fixture.validator.validate(fixture.root, CHANGE);
    assert.equal(result.ok, false, mutation);
    assert.equal(
      blockers(result).has('verification-release:case-approval-invalid'),
      true,
      mutation
    );
  }
});

test('partial-domain and light-mode input cannot reuse a persisted green gate', () => {
  const fixture = makeProject();
  const inputPath = path.join(fixture.verifyV2, 'gate-input.json');
  const input = readJson(inputPath);
  input.lane = 'light';
  input.aggregation_request.readings = input.aggregation_request.readings
    .filter((entry) => entry.domain !== 'sensory');
  writeJson(inputPath, input);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(blockers(result).has('verification-release:light-mode-not-supported'), true);
  assert.equal(blockers(result).has('verification-release:gate-input-invalid'), true);
});

test('full lane uses the same complete six-domain release and archive proof', () => {
  const fixture = makeProject();
  const inputPath = path.join(fixture.verifyV2, 'gate-input.json');
  const input = readJson(inputPath);
  input.lane = 'full';
  writeJson(inputPath, input);

  const gateInputSha256 = sha256(fs.readFileSync(inputPath));
  const indexPath = path.join(fixture.opsDir, 'host-installation-receipts.json');
  const index = readJson(indexPath);
  for (const entry of index.hosts) {
    const receiptPath = path.join(fixture.changeDir, entry.receipt_path);
    const receipt = readJson(receiptPath);
    receipt.gate_input_sha256 = gateInputSha256;
    writeJson(receiptPath, receipt);
    entry.receipt_sha256 = sha256(fs.readFileSync(receiptPath));
  }
  writeJson(indexPath, index);
  const compatibilityPath = path.join(
    fixture.opsDir,
    'cross-host-compatibility.json'
  );
  const compatibility = readJson(compatibilityPath);
  compatibility.gate_input_sha256 = gateInputSha256;
  writeJson(compatibilityPath, compatibility);

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
});

test('standard-lane missing-domain input cannot use self-consistent forged pass gates', () => {
  const fixture = makeProject();
  const inputPath = path.join(fixture.verifyV2, 'gate-input.json');
  const input = readJson(inputPath);
  const removed = input.aggregation_request.readings.find(
    (entry) => entry.domain === 'sensory'
  );
  input.aggregation_request.readings = input.aggregation_request.readings
    .filter((entry) => entry.id !== removed.id);
  writeJson(inputPath, input);

  for (const stage of ['release', 'archive']) {
    const gatePath = path.join(fixture.verifyV2, `${stage}-gate.json`);
    const gate = readJson(gatePath);
    gate.source_reading_ids = gate.source_reading_ids
      .filter((id) => id !== removed.id);
    writeJson(gatePath, reidentifyGate(gate));
  }

  const result = fixture.validator.validate(fixture.root, CHANGE);
  const ids = blockers(result);
  assert.equal(result.ok, false);
  assert.equal(ids.has('verification-release:gate-identity-invalid:release'), false);
  assert.equal(ids.has('verification-release:gate-binding-mismatch:release'), false);
  assert.equal(ids.has('verification-release:gate-recompute-mismatch:release'), true);
  assert.equal(ids.has('verification-release:kernel-gate-not-pass:release'), true);
  assert.equal(ids.has('verification-release:gate-recompute-mismatch:archive'), true);
  assert.equal(ids.has('verification-release:kernel-gate-not-pass:archive'), true);
});

test('stale evidence and open failures block both persisted pass decisions', () => {
  const fixture = makeProject();
  const inputPath = path.join(fixture.verifyV2, 'gate-input.json');
  const input = readJson(inputPath);
  input.freshness.status = 'stale';
  input.freshness.reasons = ['code_sha:mismatch'];
  input.open_failure_ids = ['failure-open'];
  writeJson(inputPath, input);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(blockers(result).has('verification-release:kernel-gate-not-pass:release'), true);
  assert.equal(blockers(result).has('verification-release:kernel-gate-not-pass:archive'), true);
});

test('all three HTML projections are required but never used as verdict authority', () => {
  const fixture = makeProject();
  fs.unlinkSync(path.join(fixture.reportsDir, 'test-case-results.html'));
  fs.writeFileSync(
    path.join(fixture.reportsDir, 'overview.html'),
    '<html>manually says green</html>\n'
  );
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:report-missing:test-case-results.html'),
    true
  );
  assert.equal(
    blockers(result).has('verification-release:report-render-mismatch:overview.html'),
    true
  );
});

test('report render manifest is required and must bind the current report model', () => {
  const fixture = makeProject();
  const manifestPath = path.join(
    fixture.verifyV2,
    'report-render-manifest.json'
  );
  const manifest = readJson(manifestPath);
  manifest.report_model_id = 'report-model-forged';
  writeJson(manifestPath, manifest);

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has(
      'verification-release:report-render-manifest-invalid'
    ),
    true
  );
});

test('missing evidence index cannot reuse green gates and reports', () => {
  const fixture = makeProject();
  fs.unlinkSync(path.join(fixture.changeDir, 'verify', 'evidence', 'index.json'));
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has(
      'verification-release:artifact-missing:verify/evidence/index.json'
    ),
    true
  );
});

test('missing canonical execution artifacts cannot reuse green gates and reports', () => {
  for (const artifact of ['runs.json', 'attempts.json', 'readings.json']) {
    const fixture = makeProject();
    fs.unlinkSync(path.join(fixture.verifyV2, artifact));

    const result = fixture.validator.validate(fixture.root, CHANGE);
    const ids = blockers(result);

    assert.equal(result.ok, false, artifact);
    assert.equal(
      ids.has(`verification-release:artifact-missing:verify/v2/${artifact}`),
      true,
      artifact
    );
    assert.equal(
      ids.has('verification-release:canonical-rebuild-blocked'),
      true,
      artifact
    );
  }
});

test('missing or tampered authority chain anchor blocks release proof', () => {
  for (const mutation of ['missing', 'tampered']) {
    const fixture = makeProject();
    const anchorPath = path.join(
      fixture.verifyV2,
      'authority-chain-anchor.json'
    );
    if (mutation === 'missing') {
      fs.unlinkSync(anchorPath);
    } else {
      const anchor = readJson(anchorPath);
      anchor.logs.transition_receipts.sequence += 1;
      writeJson(anchorPath, anchor);
    }

    const result = fixture.validator.validate(fixture.root, CHANGE);
    const ids = blockers(result);

    assert.equal(result.ok, false, mutation);
    assert.equal(
      mutation === 'missing'
        ? ids.has(
            'verification-release:artifact-missing:verify/v2/authority-chain-anchor.json'
          )
        : ids.has('verification-release:canonical-rebuild-blocked'),
      true,
      mutation
    );
    assert.equal(
      ids.has('verification-release:canonical-authority-chain-anchor-mismatch'),
      true,
      mutation
    );
  }
});

test('current code, test, and environment fingerprint drift blocks release proof', () => {
  for (const field of ['code_sha', 'test_sha', 'environment_hash']) {
    const fixture = makeProject({
      fingerprints(projectRoot, snapshot, runtimeStatus) {
        return {
          case_snapshot_hash: snapshot.snapshot_hash,
          code_sha: field === 'code_sha' ? '9'.repeat(40) : '1'.repeat(40),
          test_sha: field === 'test_sha' ? '9'.repeat(40) : '2'.repeat(40),
          environment_hash: field === 'environment_hash'
            ? '9'.repeat(64)
            : '4'.repeat(64),
          runtime_version: runtimeStatus.runtime_version,
          kernel_version: '2.0.0-alpha.2'
        };
      }
    });

    const result = fixture.validator.validate(fixture.root, CHANGE);
    const ids = blockers(result);

    assert.equal(result.ok, false, field);
    assert.equal(
      ids.has('verification-release:canonical-rebuild-blocked'),
      true,
      field
    );
    assert.equal(
      ids.has('verification-release:canonical-gate-input-mismatch'),
      true,
      field
    );
  }
});

test('required migration needs one successful schema-valid apply receipt', () => {
  const fixture = makeProject();
  writeJson(path.join(fixture.verifyV2, 'migration-status.json'), {
    schema: 'specnav.verification.migration-status.v1',
    change_id: CHANGE,
    required: true,
    legacy_artifacts: ['verify/legacy/report.json'],
    source_inventory_digest: 'c'.repeat(64),
    receipt_path: 'verify/v2/migration-receipt.json',
    scanned_at: '2026-08-02T00:00:00Z',
    fallback_used: false
  });
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(blockers(result).has('verification-release:migration-receipt-missing'), true);
});

test('required migration accepts one successful schema-valid apply receipt', () => {
  const fixture = makeProject();
  const receiptPath = path.join(fixture.verifyV2, 'migration-receipt.json');
  writeJson(path.join(fixture.verifyV2, 'migration-status.json'), {
    schema: 'specnav.verification.migration-status.v1',
    change_id: CHANGE,
    required: true,
    legacy_artifacts: ['verify/legacy/report.json'],
    source_inventory_digest: 'c'.repeat(64),
    receipt_path: 'verify/v2/migration-receipt.json',
    scanned_at: '2026-08-02T00:00:00Z',
    fallback_used: false
  });
  writeJson(receiptPath, {
    schema: 'specnav.verification.migration-receipt.v1',
    id: 'migration-release-proof',
    change_id: CHANGE,
    from_version: 'v1',
    to_version: 'v2',
    mode: 'apply',
    status: 'succeeded',
    started_at: '2026-08-02T00:00:00Z',
    completed_at: '2026-08-02T00:00:01Z',
    backup_ref: {
      id: 'backup-release-proof',
      path: 'verify/v2/backups/release-proof.json'
    },
    transformed_artifacts: [],
    validation: {
      ok: true,
      validated_entities: ['case-snapshot', 'reading'],
      blockers: []
    },
    rollback: {
      available: true,
      instructions: 'Restore the referenced verification backup.',
      receipt_ref: null
    },
    fallback_used: false
  });

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.proof.migration.required, true);
  assert.equal(result.proof.migration.receipt.id, 'migration-release-proof');
  assert.equal(result.proof.migration.receipt.path, 'verify/v2/migration-receipt.json');
  assert.match(result.proof.migration.receipt.sha256, /^[a-f0-9]{64}$/);
});

test('tampered clean-install receipt and a missing host fail closed', () => {
  const fixture = makeProject();
  const indexPath = path.join(fixture.opsDir, 'host-installation-receipts.json');
  const index = readJson(indexPath);
  const claude = index.hosts.find((entry) => entry.host === 'claude-code');
  fs.appendFileSync(path.join(fixture.changeDir, claude.receipt_path), 'tamper\n');
  index.hosts = index.hosts.filter((entry) => entry.host !== 'codefree-o');
  writeJson(indexPath, index);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:install-receipt-hash-mismatch:claude-code'),
    true
  );
  assert.equal(
    blockers(result).has('verification-release:host-installation-missing:codefree-o'),
    true
  );
});

test('placeholder clean-install claims fail closed', () => {
  const fixture = makeProject();
  const index = readJson(
    path.join(fixture.opsDir, 'host-installation-receipts.json')
  );
  const codex = index.hosts.find((entry) => entry.host === 'codex');
  const receiptFile = path.join(fixture.changeDir, codex.receipt_path);
  const receipt = readJson(receiptFile);
  receipt.command = '<decision-required>';
  writeJson(receiptFile, receipt);
  codex.receipt_sha256 = sha256(fs.readFileSync(receiptFile));
  writeJson(
    path.join(fixture.opsDir, 'host-installation-receipts.json'),
    index
  );
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:install-receipt-invalid:codex'),
    true
  );
});

test('cross-host compatibility blockers stop release and archive', () => {
  const fixture = makeProject();
  const file = path.join(fixture.opsDir, 'cross-host-compatibility.json');
  const compatibility = readJson(file);
  compatibility.ok = false;
  compatibility.blockers = ['verification-drift:schema-mismatch:claude-code:reading'];
  writeJson(file, compatibility);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:cross-host-compatibility-blocked'),
    true
  );
});

test('persisted green host claims cannot bypass a red live host authority', () => {
  const fixture = makeProject({
    hostAuthorityResult: {
      ok: false,
      commits: {},
      comparison: {
        ok: false,
        blockers: [{
          id: 'verification-drift:kernel-source-mismatch:claude-code'
        }]
      },
      summary: {
        digest: '0'.repeat(64)
      },
      blockers: [{
        id: 'verification-release:host-head-mismatch:claude-code',
        artifact: 'claude-code'
      }]
    }
  });

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has(
      'verification-release:host-head-mismatch:claude-code'
    ),
    true
  );
  assert.equal(
    blockers(result).has(
      'verification-release:cross-host-compatibility-blocked'
    ),
    true
  );
});

test('persisted green compatibility cannot bypass real live host wrapper drift', (t) => {
  const hosts = createHostAuthorityFixture(t);
  const green = hosts.authority().resolve();
  assert.equal(green.ok, true, JSON.stringify(green.blockers, null, 2));
  const fixture = makeProject({
    hostCompatibilityAuthority: hosts.authority(),
    hostCommits: green.commits
  });
  const wrapper = path.join(
    hosts.roots['claude-code'],
    hosts.descriptors['claude-code'].plugin,
    'scripts/claude-verification-adapter.js'
  );
  fs.appendFileSync(wrapper, '\n// live wrapper drift\n');

  const result = fixture.validator.validate(fixture.root, CHANGE);
  const ids = blockers(result);
  const persisted = readJson(path.join(
    fixture.opsDir,
    'cross-host-compatibility.json'
  ));

  assert.equal(persisted.ok, true);
  assert.equal(result.ok, false);
  assert.equal(
    ids.has('verification-release:host-worktree-dirty:claude-code'),
    true
  );
  assert.equal(
    ids.has(
      'verification-drift:manifest-host-file-digest-mismatch:claude-code'
    ),
    true
  );
  assert.equal(
    ids.has('verification-release:cross-host-compatibility-blocked'),
    true
  );
  assert.equal(
    [...ids].some((id) => id.includes('install-receipt-invalid')),
    false
  );
});

test('report model must bind to the release gate, readings, evidence index, and versions', () => {
  const fixture = makeProject();
  const file = path.join(fixture.verifyV2, 'report-model.json');
  const model = readJson(file);
  model.sources.gate_decision_id = 'gate-forged';
  model.sources.reading_ids = [];
  model.sources.evidence_index_version = 999;
  model.summary.kernel_version = '9.9.9';
  writeJson(file, model);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  const ids = blockers(result);
  assert.equal(ids.has('verification-release:report-gate-mismatch'), true);
  assert.equal(ids.has('verification-release:report-readings-mismatch'), true);
  assert.equal(ids.has('verification-release:report-evidence-index-mismatch'), true);
  assert.equal(ids.has('verification-release:report-kernel-version-mismatch'), true);
});

test('persisted gate edits cannot bypass Kernel-owned gate identity', () => {
  const fixture = makeProject();
  const file = path.join(fixture.verifyV2, 'release-gate.json');
  const gate = readJson(file);
  gate.source_reading_ids = [];
  writeJson(file, gate);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:gate-identity-invalid:release'),
    true
  );
});

test('explicit change ids cannot escape or bypass the active change registry', () => {
  const fixture = makeProject();
  const result = fixture.validator.validate(fixture.root, '../release-proof-change');
  assert.equal(result.ok, false);
  assert.equal(result.proof, null);
  assert.equal(
    blockers(result).has('verification-release:change-invalid'),
    true
  );
});

test('a symlinked change directory is rejected before any proof is written', () => {
  const fixture = makeProject();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-release-external-'));
  fs.renameSync(fixture.changeDir, external);
  fs.symlinkSync(external, fixture.changeDir, 'dir');

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(result.proof, null);
  assert.equal(
    blockers(result).has('verification-release:change-path-symlink'),
    true
  );
  assert.equal(
    fs.existsSync(path.join(external, 'operations', 'verification-v2-proof.json')),
    false
  );
});

test('duplicate host identities cannot satisfy the clean-install contract', () => {
  const fixture = makeProject();
  const indexPath = path.join(fixture.opsDir, 'host-installation-receipts.json');
  const index = readJson(indexPath);
  index.hosts.push({ ...index.hosts[0] });
  writeJson(indexPath, index);

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:host-installation-index-invalid'),
    true
  );
});

test('duplicate compatibility hosts cannot masquerade as all three hosts', () => {
  const fixture = makeProject();
  const file = path.join(fixture.opsDir, 'cross-host-compatibility.json');
  const compatibility = readJson(file);
  compatibility.hosts = [
    { ...compatibility.hosts[0] },
    { ...compatibility.hosts[0] },
    { ...compatibility.hosts[0] }
  ];
  writeJson(file, compatibility);

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:cross-host-compatibility-blocked'),
    true
  );
});

test('host receipts and compatibility cannot be replayed across gate inputs', () => {
  const fixture = makeProject();
  const indexPath = path.join(fixture.opsDir, 'host-installation-receipts.json');
  const index = readJson(indexPath);
  const codex = index.hosts.find((entry) => entry.host === 'codex');
  const receiptFile = path.join(fixture.changeDir, codex.receipt_path);
  const receipt = readJson(receiptFile);
  receipt.release_gate_id = 'gate-from-an-older-release';
  writeJson(receiptFile, receipt);
  codex.receipt_sha256 = sha256(fs.readFileSync(receiptFile));
  writeJson(indexPath, index);

  const compatibilityFile = path.join(
    fixture.opsDir,
    'cross-host-compatibility.json'
  );
  const compatibility = readJson(compatibilityFile);
  compatibility.gate_input_sha256 = '0'.repeat(64);
  writeJson(compatibilityFile, compatibility);

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:install-receipt-invalid:codex'),
    true
  );
  assert.equal(
    blockers(result).has('verification-release:cross-host-compatibility-blocked'),
    true
  );
});

test('a symlinked operations directory cannot receive a blocked proof write', () => {
  const fixture = makeProject();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-release-ops-'));
  const externalOps = path.join(external, 'operations');
  fs.renameSync(fixture.opsDir, externalOps);
  fs.symlinkSync(externalOps, fixture.opsDir, 'dir');

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:proof-path-symlink'),
    true
  );
  assert.equal(
    fs.existsSync(path.join(externalOps, 'verification-v2-proof.json')),
    false
  );
});

test('writeArchiveGate does not persist a gate or log when validation fails', () => {
  const fixture = makeProject();

  const result = writeArchiveGate(fixture.root);

  assert.equal(result.verdict, 'red');
  assert.equal(
    fs.existsSync(path.join(fixture.opsDir, 'archive-gate.json')),
    false
  );
  assert.equal(
    fs.existsSync(path.join(fixture.opsDir, 'archive-log.jsonl')),
    false
  );
});

test('writeArchiveGate does not follow symlinked operations or parent directories', () => {
  for (const mode of ['operations', 'changes']) {
    const fixture = makeProject();
    const external = fs.mkdtempSync(
      path.join(os.tmpdir(), `specnav-archive-${mode}-`)
    );
    let externalOps;
    if (mode === 'operations') {
      externalOps = path.join(external, 'operations');
      fs.renameSync(fixture.opsDir, externalOps);
      fs.symlinkSync(externalOps, fixture.opsDir, 'dir');
    } else {
      const changesRoot = path.join(fixture.root, 'openspec', 'changes');
      const externalChanges = path.join(external, 'changes');
      fs.renameSync(changesRoot, externalChanges);
      fs.symlinkSync(externalChanges, changesRoot, 'dir');
      externalOps = path.join(externalChanges, CHANGE, 'operations');
    }

    const result = writeArchiveGate(fixture.root);

    assert.equal(result.verdict, 'red', mode);
    assert.equal(
      fs.existsSync(path.join(externalOps, 'archive-gate.json')),
      false,
      mode
    );
    assert.equal(
      fs.existsSync(path.join(externalOps, 'archive-log.jsonl')),
      false,
      mode
    );
  }
});

test('safe archive JSONL append is atomic and rejects a symlink target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-archive-safe-fs-'));
  const operations = path.join(root, 'operations');
  const log = path.join(operations, 'archive-log.jsonl');
  fs.mkdirSync(operations, { recursive: true });

  safeFs.appendJsonl(
    root,
    log,
    { id: 'archive-1', verdict: 'green' },
    'verification-operations:test-archive-log'
  );
  safeFs.appendJsonl(
    root,
    log,
    { id: 'archive-2', verdict: 'red' },
    'verification-operations:test-archive-log'
  );
  assert.equal(
    fs.readFileSync(log, 'utf8'),
    '{"id":"archive-1","verdict":"green"}\n'
      + '{"id":"archive-2","verdict":"red"}\n'
  );

  const external = path.join(root, 'external-log.jsonl');
  fs.writeFileSync(external, 'trusted\n');
  const symlink = path.join(operations, 'symlink-log.jsonl');
  fs.symlinkSync(external, symlink);

  assert.throws(
    () => safeFs.appendJsonl(
      root,
      symlink,
      { id: 'forged' },
      'verification-operations:test-archive-log'
    ),
    /verification-operations:test-archive-log:symlink/
  );
  assert.equal(fs.readFileSync(external, 'utf8'), 'trusted\n');

  const externalGate = path.join(root, 'external-gate.json');
  fs.writeFileSync(externalGate, '{"trusted":true}\n');
  const gateSymlink = path.join(operations, 'symlink-gate.json');
  fs.symlinkSync(externalGate, gateSymlink);
  assert.throws(
    () => safeFs.atomicWriteJson(
      root,
      gateSymlink,
      { forged: true },
      'verification-operations:test-archive-gate'
    ),
    /verification-operations:test-archive-gate:symlink/
  );
  assert.equal(
    fs.readFileSync(externalGate, 'utf8'),
    '{"trusted":true}\n'
  );
});
