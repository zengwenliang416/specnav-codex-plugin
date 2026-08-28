'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const nodeTest = require('node:test');

const {
  createShardTest
} = require('./release-suite-runner');

const test = createShardTest(nodeTest);

const kernel = require('../../../plugins/specnav-verification/kernel');
const {
  SIX_DOMAINS,
  codeInventorySha,
  createDecisionEngine,
  createSixDomainAggregator
} = kernel;
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
  createReleaseProofValidator,
  resolveCurrentFingerprints
} = require('../../../plugins/specnav-operations/scripts/verification-v2-proof');
const {
  writeArchiveGate
} = require('../../../plugins/specnav-operations/scripts/operations-gate');
const safeFs = require('../../../plugins/specnav-operations/scripts/safe-filesystem');
const {
  hostProofRunnerSourceDigest,
  managedFixtureManifestDigest
} = require('../../../plugins/specnav-operations/scripts/verification-v2-host-contract');
const {
  validateHostProofPointerChain
} = require('../../../plugins/specnav-operations/scripts/verification-v2-pointer-chain');
const CHANGE = 'release-proof-change';
const CASE_ID = 'case-release-proof';
const HOSTS = ['claude-code', 'codex', 'codefree-o', 'dsh'];
const RUNTIME_VERSION = loadRuntimeLock().runtime_version;
const TRUST_KEY = Buffer.alloc(32, 17);
const ROOT = path.resolve(__dirname, '../../..');
const RUNNER_SOURCE_SHA256 = hostProofRunnerSourceDigest(ROOT);
const FIXTURE_MANIFEST_SHA256 = managedFixtureManifestDigest(path.join(
  ROOT,
  'plugins',
  'specnav-verification',
  'assets',
  'contract-fixtures'
));
const SOURCE_TREE_INVENTORY = [
  '100644 blob 1111111111111111111111111111111111111111\tREADME.md',
  '100644 blob 2222222222222222222222222222222222222222\tsrc/index.js',
  ''
].join('\n');
const SOURCE_CODE_SHA = codeInventorySha(SOURCE_TREE_INVENTORY);

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
    code_sha: SOURCE_CODE_SHA,
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
    evidence_index_version: SIX_DOMAINS.length,
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
  const generationFingerprints = {
    case_snapshot_hash: snapshot.snapshot_hash,
    code_sha: SOURCE_CODE_SHA,
    test_sha: '2'.repeat(40),
    environment_hash: '4'.repeat(64),
    runtime_version: RUNTIME_VERSION,
    kernel_version: '2.0.0-alpha.2'
  };
  const generationStore = kernel.createVerificationArtifactStore({
    changeRoot: changeDir,
    root: path.join(changeDir, 'verify')
  });
  const generationAuthority = kernel.createVerificationGenerationAuthority({
    schemaRegistry,
    key: TRUST_KEY,
    clock: () => '2026-08-02T00:00:00.500Z'
  });
  const generationState = {
    change_id: CHANGE,
    reviewer_id: reviewer().id,
    snapshot_id: snapshot.id,
    snapshot_hash: snapshot.snapshot_hash,
    parent_generation_id: null,
    fingerprints: generationFingerprints,
    historical_break_loop_failure_ids: [],
    collections: {
      runs: [],
      attempts: [],
      executions: [],
      readings: [],
      failures: [],
      repair_links: [],
      evidence: [],
      transition_proposals: [],
      transition_receipts: [],
      attempt_facts: []
    }
  };
  const generationReview = generationAuthority.prepare(generationState);
  assert.equal(
    generationReview.ok,
    true,
    JSON.stringify(generationReview.blockers)
  );
  const generationActivation = generationAuthority.append(
    generationStore,
    generationReview.review,
    generationState,
    true
  );
  assert.equal(
    generationActivation.ok,
    true,
    JSON.stringify(generationActivation.blockers)
  );
  const activeGeneration = generationActivation.value;
  const input = gateInput();
  if (options.lane) input.lane = options.lane;
  input.case_snapshot_id = snapshot.id;
  input.case_snapshot_hash = snapshot.snapshot_hash;
  input.generation_id = activeGeneration.id;
  const run = {
    schema: 'specnav.verification.run.v1',
    id: 'run-release',
    change_id: CHANGE,
    generation_id: activeGeneration.id,
    case_snapshot_id: snapshot.id,
    case_snapshot_hash: snapshot.snapshot_hash,
    case_ids: [CASE_ID],
    code_sha: SOURCE_CODE_SHA,
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
    logs: authorityHeads,
    generation_id: activeGeneration.id,
    generation_digest: sha256(canonicalJson(activeGeneration))
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
      generation_id: activeGeneration.id,
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
    HOSTS.map((host, index) => [host, ['7', '8', '9', 'a'][index].repeat(40)])
  );
  const hostRepositories = {
    'claude-code':
      'https://github.com/zengwenliang416/specnav-claude-plugin.git',
    codex: 'https://github.com/zengwenliang416/specnav-codex-plugin.git',
    'codefree-o':
      'https://github.com/zengwenliang416/specnav-codefree-o-plugin.git',
    dsh: 'https://github.com/zengwenliang416/specnav-dsh-plugin.git'
  };
  const hostPluginPaths = {
    'claude-code': 'plugins/specnav-verification',
    codex: 'plugins/specnav-verification',
    'codefree-o': 'modules/specnav-verification',
    dsh: 'modules/specnav-verification'
  };
  const defaultHostRoots = Object.fromEntries(HOSTS.map((host) => {
    const hostRoot = path.join(root, '.host-authority', host);
    fs.mkdirSync(path.join(hostRoot, hostPluginPaths[host]), {
      recursive: true
    });
    return [host, hostRoot];
  }));
  const defaultHostLock = {
    schema: 'specnav.verification.cross-host-lock.v1',
    source_host: 'codex',
    source: {
      repository: hostRepositories.codex,
      ref: 'refs/heads/main',
      commit: configuredCommits.codex,
      plugin_path: hostPluginPaths.codex,
      manifest_path: null
    },
    hosts: {
      'claude-code': {
        repository: hostRepositories['claude-code'],
        ref: 'refs/heads/main',
        commit: configuredCommits['claude-code'],
        plugin_path: hostPluginPaths['claude-code'],
        manifest_path: 'plugins/specnav-verification/specnav-kernel-source.json'
      },
      'codefree-o': {
        repository: hostRepositories['codefree-o'],
        ref: 'refs/heads/main',
        commit: configuredCommits['codefree-o'],
        plugin_path: hostPluginPaths['codefree-o'],
        manifest_path: 'modules/specnav-verification/specnav-kernel-source.json'
      },
      dsh: {
        repository: hostRepositories.dsh,
        ref: 'refs/heads/main',
        commit: configuredCommits.dsh,
        plugin_path: hostPluginPaths.dsh,
        manifest_path: 'modules/specnav-verification/specnav-kernel-source.json'
      }
    },
    generated_at: '2026-08-02T00:00:05Z',
    fallback_used: false
  };
  const runId = 'host-proof-release';
  const runRoot = path.join('operations', 'host-proof-runs', runId);
  const lockPath = path.join(runRoot, 'cross-host-lock.json');
  writeJson(path.join(changeDir, lockPath), defaultHostLock);
  const lockSha = sha256(fs.readFileSync(path.join(changeDir, lockPath)));
  const snapshots = Object.fromEntries(HOSTS.map((host) => [
    host,
    sha256(`snapshot:${host}`)
  ]));
  const comparisonDigest = sha256('comparison:green');
  const authoritySummary = {
    lock_sha256: lockSha,
    commits: configuredCommits,
    repositories: hostRepositories,
    heads: configuredCommits,
    snapshots,
    comparison: comparisonDigest
  };
  authoritySummary.digest = sha256(canonicalJson(authoritySummary));
  const tools = {
    node: fs.realpathSync(process.execPath),
    git: fs.realpathSync('/usr/bin/git'),
    bash: fs.realpathSync('/bin/bash'),
    npm: fs.realpathSync(path.resolve(
      path.dirname(process.execPath),
      '../lib/node_modules/npm/bin/npm-cli.js'
    )),
    sandbox: fs.realpathSync(process.platform === 'darwin'
      ? '/usr/bin/sandbox-exec'
      : ['/usr/bin/bwrap', '/bin/bwrap'].find((entry) => fs.existsSync(entry)))
  };
  const toolchain = Object.fromEntries(
    Object.entries(tools).map(([name, file]) => [
      name,
      {
        path: file,
        sha256: sha256(fs.readFileSync(file))
      }
    ])
  );
  const runnerIdentitySha256 = kernel.createHostRunnerIdentity(
    RUNNER_SOURCE_SHA256,
    toolchain
  );
  let commandSequence = 0;
  function hostCommand(host, id, argv, stdoutValue = null) {
    const index = commandSequence++;
    const stdoutPath = path.join(
      runRoot,
      `${host}-${index + 1}.stdout.log`
    );
    const stderrPath = path.join(
      runRoot,
      `${host}-${index + 1}.stderr.log`
    );
    const stdout = Buffer.from(stdoutValue ?? `completed ${id}\n`);
    const stderr = Buffer.alloc(0);
    fs.mkdirSync(path.dirname(path.join(changeDir, stdoutPath)), {
      recursive: true
    });
    fs.writeFileSync(path.join(changeDir, stdoutPath), stdout);
    fs.writeFileSync(path.join(changeDir, stderrPath), stderr);
    const startedAt = new Date(
      Date.parse('2026-08-02T00:00:05Z') + index * 1000
    ).toISOString();
    const sandboxed = [
      'dependency-install',
      'runtime-doctor',
      'host-smoke'
    ].includes(id);
    const sandbox = sandboxed
      ? kernel.createHostSandboxPlan({
          toolchain,
          allowedRoots: [
            ...HOSTS.map((candidate) => defaultHostRoots[candidate]),
            ...(id === 'runtime-doctor'
              ? [schemaRegistry.runtime_root]
              : []),
            path.dirname(path.dirname(tools.node))
          ],
          writableRoots: [
            path.join(
              path.dirname(defaultHostRoots.codex),
              '.runtime',
              host
            ),
            ...(id === 'dependency-install'
              ? [defaultHostRoots[host]]
              : [])
          ],
          pathAliases: [{
            path: path.dirname(defaultHostRoots.codex),
            identity: '$WORKSPACE'
          }],
          allowNetwork: id === 'dependency-install'
        })
      : null;
    const effectiveSandbox = typeof options.sandboxPlanMutator === 'function'
      ? (
          options.sandboxPlanMutator({
            defaultHostRoots,
            host,
            id,
            runtimeRoot: schemaRegistry.runtime_root,
            sandbox,
            toolchain
          }) || sandbox
        )
      : sandbox;
    return {
      id,
      argv,
      executable_realpath: argv[0],
      executable_sha256: sha256(fs.readFileSync(argv[0])),
      sandbox_executable_realpath: effectiveSandbox?.executable.path || null,
      sandbox_executable_sha256: effectiveSandbox?.executable.sha256 || null,
      sandbox_policy_sha256: effectiveSandbox?.policy_sha256 || null,
      sandbox_argv: effectiveSandbox?.argv || null,
      exit_status: 0,
      signal: null,
      stdout_sha256: sha256(stdout),
      stderr_sha256: sha256(stderr),
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      started_at: startedAt,
      completed_at: new Date(Date.parse(startedAt) + 500).toISOString()
    };
  }
  function hostCommands(host, rootPath, locked) {
    const commands = [
      hostCommand(host, 'remote-ref', [
        tools.git,
        'ls-remote',
        '--refs',
        locked.repository,
        locked.ref
      ], `${locked.commit}\t${locked.ref}\n`),
      hostCommand(host, 'checkout-init', [
        tools.git,
        '-c',
        'core.hooksPath=/dev/null',
        'init',
        '--quiet'
      ]),
      hostCommand(host, 'checkout-remote', [
        tools.git,
        '-c',
        'core.hooksPath=/dev/null',
        'remote',
        'add',
        'origin',
        locked.repository
      ]),
      hostCommand(host, 'checkout-fetch', [
        tools.git,
        '-c',
        'core.hooksPath=/dev/null',
        'fetch',
        '--quiet',
        '--depth=1',
        'origin',
        locked.ref
      ]),
      hostCommand(host, 'checkout-detach', [
        tools.git,
        '-c',
        'core.hooksPath=/dev/null',
        'checkout',
        '--quiet',
        '--detach',
        locked.commit
      ]),
      hostCommand(host, 'checkout-head', [
        tools.git,
        'rev-parse',
        'HEAD^{commit}'
      ], `${locked.commit}\n`)
    ];
    if (host === 'codex') {
      commands.push(hostCommand(host, 'checkout-tree', [
        tools.git,
        'ls-tree',
        '-r',
        'HEAD'
      ], SOURCE_TREE_INVENTORY));
    }
    if (['codefree-o', 'dsh'].includes(host)) {
      commands.push(hostCommand(host, 'dependency-install', [
        tools.npm,
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund'
      ]));
    }
    commands.push(
      hostCommand(host, 'runtime-doctor', [
        tools.node,
        path.join(
          defaultHostRoots.codex,
          hostPluginPaths.codex,
          'scripts',
          'verification-runtime.js'
        ),
        'doctor',
        '--version',
        RUNTIME_VERSION,
        '--project',
        rootPath,
        '--root',
        path.dirname(schemaRegistry.runtime_root),
        '--json'
      ]),
      hostCommand(host, 'host-smoke', [
        tools.bash,
        path.join(rootPath, 'tests', 'run-smoke.sh')
      ])
    );
    return commands;
  }
  const records = HOSTS.map((host) => {
    const receiptPath = path.join(runRoot, `${host}.receipt.json`);
    const locked = host === 'codex'
      ? defaultHostLock.source
      : defaultHostLock.hosts[host];
    const commands = hostCommands(host, defaultHostRoots[host], locked);
    const executionPayload = {
      schema: 'specnav.verification.host-execution.v1',
      change_id: CHANGE,
      run_id: runId,
      host,
      status: 'passed',
      repository: locked.repository,
      ref: locked.ref,
      commit: locked.commit,
      host_lock_sha256: lockSha,
      ...releaseBindings,
      runtime_authority_digest: 'b'.repeat(64),
      host_authority_digest: authoritySummary.digest,
      source_snapshot_digest: snapshots[host],
      runner_identity_sha256: runnerIdentitySha256,
      runner_source_sha256: RUNNER_SOURCE_SHA256,
      environment_sha256: '8'.repeat(64),
      fixture_snapshot_digest: options.hostFixtureDigests?.[host]
        || sha256('managed-fixture-snapshot'),
      fixture_manifest_sha256: options.fixtureManifestSha256
        || FIXTURE_MANIFEST_SHA256,
      observations: {
        advertised_commit: locked.commit,
        checkout_head: locked.commit,
        source_code_inventory_sha: host === 'codex' ? SOURCE_CODE_SHA : null,
        package_lock_sha256: ['codefree-o', 'dsh'].includes(host)
          ? sha256('codefree-package-lock')
          : null
      },
      commands,
      blocker: null,
      started_at: commands[0].started_at,
      completed_at: commands.at(-1).completed_at
    };
    const executionEnvelope = trustedFactAuthority.seal(
      'host_execution',
      executionPayload,
      {
        failure_id: runId,
        change_id: CHANGE,
        run_id: runId,
        case_id: host
      }
    );
    const envelopePath = path.join(runRoot, `${host}.execution-envelope.json`);
    writeJson(path.join(changeDir, envelopePath), executionEnvelope);
    const receipt = {
      schema: 'specnav.verification.host-install-receipt.v1',
      host,
      ...releaseBindings,
      host_lock_sha256: lockSha,
      runtime_authority_digest: 'b'.repeat(64),
      runner_identity_sha256: runnerIdentitySha256,
      runner_source_sha256: RUNNER_SOURCE_SHA256,
      source_snapshot_digest: snapshots[host],
      fixture_snapshot_digest: executionPayload.fixture_snapshot_digest,
      fixture_manifest_sha256: executionPayload.fixture_manifest_sha256,
      repository: locked.repository,
      ref: locked.ref,
      commit: locked.commit,
      remote_commit_reachable: true,
      checkout_realpath: defaultHostRoots[host],
      plugin_realpath: path.join(
        defaultHostRoots[host],
        locked.plugin_path
      ),
      clean_checkout: true,
      plugin_discovered: true,
      runtime_ready: true,
      checks: [
        {
          id: 'plugin-discovery',
          status: 'pass',
          evidence: 'The expected plugin path exists.'
        },
        {
          id: 'remote-commit-reachability',
          status: 'pass',
          evidence: 'The locked commit is reachable.'
        },
        {
          id: 'runtime-doctor',
          status: 'pass',
          evidence: 'The runtime doctor completed.'
        },
        {
          id: 'host-smoke',
          status: 'pass',
          evidence: 'The host smoke command completed.'
        }
      ],
      execution: {
        commands: commands.map((command) => ({
          argv: command.argv,
          exit_status: command.exit_status,
          stdout_sha256: command.stdout_sha256,
          stderr_sha256: command.stderr_sha256,
          stdout_path: command.stdout_path,
          stderr_path: command.stderr_path
        })),
        environment_sha256: executionPayload.environment_sha256,
        started_at: executionPayload.started_at,
        completed_at: executionPayload.completed_at
      },
      execution_envelope_path: envelopePath,
      execution_envelope_sha256: sha256(
        fs.readFileSync(path.join(changeDir, envelopePath))
      ),
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
  const indexPath = path.join(runRoot, 'host-installation-index.json');
  writeJson(path.join(changeDir, indexPath), {
    schema: 'specnav.verification.host-installation-index.v1',
    change_id: CHANGE,
    host_lock_sha256: lockSha,
    hosts: records,
    fallback_used: false
  });
  const compatibilityPath = path.join(
    runRoot,
    'cross-host-compatibility.json'
  );
  writeJson(path.join(changeDir, compatibilityPath), {
    schema: 'specnav.verification.cross-host-release-result.v1',
    ...releaseBindings,
    host_lock_sha256: lockSha,
    authority_digest: authoritySummary.digest,
    comparison_digest: authoritySummary.comparison,
    ok: true,
    hosts: records.map((entry) => ({
      host: entry.host,
      commit: entry.commit,
      snapshot_digest: snapshots[entry.host],
      receipt_sha256: entry.receipt_sha256
    })),
    kernel_version: input.kernel_version,
    blockers: [],
    fallback_used: false,
    recorded_at: '2026-08-02T00:00:06Z'
  });
  const pointer = {
    schema: 'specnav.verification.host-proof-pointer.v1',
    change_id: CHANGE,
    run_id: runId,
    host_lock_sha256: lockSha,
    runtime_authority_digest: 'b'.repeat(64),
    generation: 1,
    previous_pointer: null,
    lock: {
      path: lockPath,
      sha256: lockSha
    },
    index: {
      path: indexPath,
      sha256: sha256(fs.readFileSync(path.join(changeDir, indexPath)))
    },
    compatibility: {
      path: compatibilityPath,
      sha256: sha256(fs.readFileSync(path.join(changeDir, compatibilityPath)))
    },
    published_at: '2026-08-02T00:00:06Z',
    fallback_used: false
  };
  writeJson(path.join(opsDir, 'host-proof-current.json'), pointer);
  writeJson(path.join(changeDir, runRoot, 'host-proof-pointer.json'), pointer);
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
    requireHostProof: true,
    fingerprints: options.fingerprints || (() => ({
      case_snapshot_hash: snapshot.snapshot_hash,
      code_sha: run.code_sha,
      test_sha: run.test_sha,
      environment_hash: run.environment_hash,
      runtime_version: run.runtime_version,
      kernel_version: run.kernel_version
    })),
    expectedHostRunnerSourceSha256: RUNNER_SOURCE_SHA256,
    expectedFixtureManifestSha256: FIXTURE_MANIFEST_SHA256,
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
    hostProof: {
      runId,
      lockPath,
      indexPath,
      compatibilityPath
    },
    validator: createReleaseProofValidator(validatorOptions)
  };
}

function blockers(result) {
  return new Set(result.blockers.map((entry) => entry.id));
}

function hostProofPointer(fixture) {
  return readJson(path.join(fixture.opsDir, 'host-proof-current.json'));
}

function hostProofArtifact(fixture, name) {
  const pointer = hostProofPointer(fixture);
  const reference = pointer[name];
  return {
    pointer,
    file: path.join(fixture.changeDir, reference.path),
    value: readJson(path.join(fixture.changeDir, reference.path))
  };
}

function writeHostProofArtifact(fixture, name, value) {
  const { pointer, file } = hostProofArtifact(fixture, name);
  writeJson(file, value);
  pointer[name].sha256 = sha256(fs.readFileSync(file));
  writeJson(path.join(fixture.opsDir, 'host-proof-current.json'), pointer);
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
  const fixture = makeProject({ lane: 'full' });
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

test('release proof uses the same governance-excluding code fingerprint as execution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-release-fingerprint-'));
  fs.mkdirSync(path.join(root, 'openspec'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'specnav-verification'), {
    recursive: true
  });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'product.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'openspec', 'state.json'), '{}\n');
  fs.writeFileSync(
    path.join(root, 'plugins', 'specnav-verification', 'kernel.js'),
    'module.exports = true;\n'
  );
  fs.writeFileSync(path.join(root, 'tests', 'smoke.js'), 'process.exit(0);\n');
  const runGit = (args) => {
    const result = require('node:child_process').spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  runGit(['init', '--quiet']);
  runGit(['config', 'user.name', 'SpecNav Test']);
  runGit(['config', 'user.email', 'specnav@example.invalid']);
  runGit(['add', '.']);
  runGit(['commit', '--quiet', '-m', 'test: fixture']);

  const snapshot = { snapshot_hash: 'a'.repeat(64) };
  const runtimeStatus = {
    runtime_version: RUNTIME_VERSION,
    runtime_root: '/tmp/specnav-runtime'
  };
  const runtimeAuthority = { digest: 'b'.repeat(64) };
  const before = resolveCurrentFingerprints(
    root,
    snapshot,
    runtimeStatus,
    runtimeAuthority
  );
  const inventory = runGit(['ls-tree', '-r', 'HEAD']);
  assert.equal(
    before.code_sha,
    require('../../../plugins/specnav-verification/kernel')
      .codeInventorySha(inventory)
  );

  fs.writeFileSync(path.join(root, 'openspec', 'state.json'), '{"updated":true}\n');
  runGit(['add', 'openspec/state.json']);
  runGit(['commit', '--quiet', '-m', 'test: governance-only change']);
  const after = resolveCurrentFingerprints(
    root,
    snapshot,
    runtimeStatus,
    runtimeAuthority
  );
  assert.equal(after.code_sha, before.code_sha);
  assert.equal(after.test_sha, before.test_sha);
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
  const { value: index } = hostProofArtifact(fixture, 'index');
  const claude = index.hosts.find((entry) => entry.host === 'claude-code');
  const receiptFile = path.join(fixture.changeDir, claude.receipt_path);
  const receipt = readJson(receiptFile);
  receipt.recorded_at = '2026-08-02T00:00:06Z';
  writeJson(receiptFile, receipt);
  index.hosts = index.hosts.filter((entry) => entry.host !== 'codefree-o');
  writeHostProofArtifact(fixture, 'index', index);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:install-receipt-hash-mismatch:claude-code'),
    true,
    JSON.stringify(result.blockers)
  );
  assert.equal(
    blockers(result).has('verification-release:host-installation-missing:codefree-o'),
    true
  );
});

test('placeholder clean-install claims fail closed', () => {
  const fixture = makeProject();
  const { value: index } = hostProofArtifact(fixture, 'index');
  const codex = index.hosts.find((entry) => entry.host === 'codex');
  const receiptFile = path.join(fixture.changeDir, codex.receipt_path);
  const receipt = readJson(receiptFile);
  receipt.execution.commands[0].argv = ['<decision-required>'];
  writeJson(receiptFile, receipt);
  codex.receipt_sha256 = sha256(fs.readFileSync(receiptFile));
  writeHostProofArtifact(fixture, 'index', index);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:install-receipt-invalid:codex'),
    true
  );
});

test('cross-host compatibility blockers stop release and archive', () => {
  const fixture = makeProject();
  const { value: compatibility } = hostProofArtifact(
    fixture,
    'compatibility'
  );
  compatibility.ok = false;
  compatibility.blockers = ['verification-drift:schema-mismatch:claude-code:reading'];
  writeHostProofArtifact(fixture, 'compatibility', compatibility);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:cross-host-compatibility-blocked'),
    true
  );
});

test('all host executions must use the same managed fixture snapshot', () => {
  const fixture = makeProject({
    hostFixtureDigests: {
      codex: sha256('different-managed-fixture-snapshot')
    }
  });

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:fixture-snapshot-mismatch'),
    true,
    JSON.stringify(result.blockers)
  );
});

test('release proof reconstructs exact sandbox plans and rejects permission drift', () => {
  const mutations = [
    {
      name: 'fake-executable',
      mutate({ host, id, sandbox }) {
        if (host !== 'codex' || id !== 'host-smoke') return sandbox;
        const executable = {
          path: fs.realpathSync('/bin/bash'),
          sha256: sha256(fs.readFileSync('/bin/bash'))
        };
        return {
          ...sandbox,
          executable,
          argv: [executable.path, ...sandbox.argv.slice(1)]
        };
      }
    },
    {
      name: 'random-policy',
      mutate({ host, id, sandbox }) {
        if (host !== 'codex' || id !== 'host-smoke') return sandbox;
        return {
          ...sandbox,
          policy_sha256: '0'.repeat(64)
        };
      }
    },
    {
      name: 'smoke-runtime-read',
      mutate({
        defaultHostRoots,
        host,
        id,
        runtimeRoot,
        sandbox,
        toolchain
      }) {
        if (host !== 'codex' || id !== 'host-smoke') return sandbox;
        return kernel.createHostSandboxPlan({
          toolchain,
          allowedRoots: [
            ...HOSTS.map((candidate) => defaultHostRoots[candidate]),
            runtimeRoot,
            path.dirname(path.dirname(toolchain.node.path))
          ],
          writableRoots: [path.join(
            path.dirname(defaultHostRoots.codex),
            '.runtime',
            host
          )],
          allowNetwork: false
        });
      }
    },
    {
      name: 'doctor-network',
      mutate({
        defaultHostRoots,
        host,
        id,
        runtimeRoot,
        sandbox,
        toolchain
      }) {
        if (host !== 'codex' || id !== 'runtime-doctor') return sandbox;
        return kernel.createHostSandboxPlan({
          toolchain,
          allowedRoots: [
            ...HOSTS.map((candidate) => defaultHostRoots[candidate]),
            runtimeRoot,
            path.dirname(path.dirname(toolchain.node.path))
          ],
          writableRoots: [path.join(
            path.dirname(defaultHostRoots.codex),
            '.runtime',
            host
          )],
          allowNetwork: true
        });
      }
    },
    {
      name: 'dependency-checkout-read-only',
      mutate({
        defaultHostRoots,
        host,
        id,
        sandbox,
        toolchain
      }) {
        if (host !== 'codefree-o' || id !== 'dependency-install') {
          return sandbox;
        }
        return kernel.createHostSandboxPlan({
          toolchain,
          allowedRoots: [
            ...HOSTS.map((candidate) => defaultHostRoots[candidate]),
            path.dirname(path.dirname(toolchain.node.path))
          ],
          writableRoots: [path.join(
            path.dirname(defaultHostRoots.codex),
            '.runtime',
            host
          )],
          allowNetwork: true
        });
      }
    }
  ];

  for (const mutation of mutations) {
    const fixture = makeProject({
      sandboxPlanMutator: mutation.mutate
    });
    const result = fixture.validator.validate(fixture.root, CHANGE);
    assert.equal(result.ok, false, mutation.name);
    assert.equal(
      [...blockers(result)].some((id) => (
        id.startsWith(
          'verification-release:install-command-evidence-mismatch:'
        )
      )),
      true,
      mutation.name
    );
  }
});

test('managed fixture manifest is bound to the trusted local corpus', () => {
  const fixture = makeProject({
    fixtureManifestSha256: '0'.repeat(64)
  });

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:fixture-manifest-mismatch'),
    true
  );
});

test('a tampered host execution envelope cannot manufacture trusted facts', () => {
  const fixture = makeProject();
  const { value: index } = hostProofArtifact(fixture, 'index');
  const codex = index.hosts.find((entry) => entry.host === 'codex');
  const receiptFile = path.join(fixture.changeDir, codex.receipt_path);
  const receipt = readJson(receiptFile);
  const envelopeFile = path.join(
    fixture.changeDir,
    receipt.execution_envelope_path
  );
  const envelope = readJson(envelopeFile);
  envelope.payload.host_authority_digest = '0'.repeat(64);
  writeJson(envelopeFile, envelope);
  receipt.execution_envelope_sha256 = sha256(fs.readFileSync(envelopeFile));
  writeJson(receiptFile, receipt);
  codex.receipt_sha256 = sha256(fs.readFileSync(receiptFile));
  writeHostProofArtifact(fixture, 'index', index);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has(
      'verification-release:host-execution-envelope-invalid:codex'
    ),
    true
  );
});

test('the current pointer cannot mix artifacts from different proof runs', () => {
  const fixture = makeProject();
  const pointer = hostProofPointer(fixture);
  const source = path.join(
    fixture.changeDir,
    pointer.compatibility.path
  );
  const alternatePath = path.join(
    'operations',
    'host-proof-runs',
    'different-run',
    'cross-host-compatibility.json'
  );
  const alternateFile = path.join(fixture.changeDir, alternatePath);
  fs.mkdirSync(path.dirname(alternateFile), { recursive: true });
  fs.copyFileSync(source, alternateFile);
  pointer.compatibility = {
    path: alternatePath,
    sha256: sha256(fs.readFileSync(alternateFile))
  };
  writeJson(path.join(fixture.opsDir, 'host-proof-current.json'), pointer);
  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:host-proof-run-mismatch'),
    true
  );
});

test('a rolled-back current pointer cannot disagree with its immutable copy', () => {
  const fixture = makeProject();
  const pointer = hostProofPointer(fixture);
  pointer.published_at = '2026-08-01T00:00:00Z';
  writeJson(path.join(fixture.opsDir, 'host-proof-current.json'), pointer);

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has(
      'verification-release:host-proof-pointer-copy-mismatch'
    ),
    true
  );
});

test('host proof pointer generation semantics fail closed', () => {
  for (const mutation of [
    {
      generation: 1,
      previous_pointer: {
        path: 'operations/host-proof-runs/old/host-proof-pointer.json',
        sha256: 'a'.repeat(64)
      }
    },
    {
      generation: 2,
      previous_pointer: null
    }
  ]) {
    const fixture = makeProject();
    const pointer = {
      ...hostProofPointer(fixture),
      ...mutation
    };
    writeJson(path.join(fixture.opsDir, 'host-proof-current.json'), pointer);
    writeJson(
      path.join(
        fixture.changeDir,
        'operations',
        'host-proof-runs',
        pointer.run_id,
        'host-proof-pointer.json'
      ),
      pointer
    );

    const result = fixture.validator.validate(fixture.root, CHANGE);

    assert.equal(result.ok, false, JSON.stringify(mutation));
    assert.equal(
      blockers(result).has(
        'verification-release:host-proof-pointer-generation-invalid'
      ),
      true,
      JSON.stringify(mutation)
    );
  }
});

test('host proof pointer rejects a forged predecessor digest', () => {
  const fixture = makeProject();
  const pointer = {
    ...hostProofPointer(fixture),
    generation: 2,
    previous_pointer: {
      path: 'operations/host-proof-runs/forged/host-proof-pointer.json',
      sha256: 'f'.repeat(64)
    }
  };
  writeJson(path.join(fixture.opsDir, 'host-proof-current.json'), pointer);
  writeJson(
    path.join(
      fixture.changeDir,
      'operations',
      'host-proof-runs',
      pointer.run_id,
      'host-proof-pointer.json'
    ),
    pointer
  );

  const result = fixture.validator.validate(fixture.root, CHANGE);

  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has(
      'verification-release:host-proof-pointer-predecessor-hash-mismatch'
    ),
    true
  );
});

test('host proof pointer accepts a complete generation-two chain', () => {
  const previous = {
    schema: 'specnav.verification.host-proof-pointer.v1',
    change_id: CHANGE,
    run_id: 'host-proof-release-1',
    generation: 1,
    previous_pointer: null
  };
  const previousBytes = Buffer.from(`${JSON.stringify(previous)}\n`);
  const previousPath = (
    `operations/host-proof-runs/${previous.run_id}/`
    + 'host-proof-pointer.json'
  );
  const pointer = {
    ...previous,
    run_id: 'host-proof-release-2',
    generation: 2,
    previous_pointer: {
      path: previousPath,
      sha256: sha256(previousBytes)
    }
  };
  assert.equal(validateHostProofPointerChain({
    changeId: CHANGE,
    pointer,
    pointerPath: 'operations/host-proof-current.json',
    readPointer(candidate) {
      assert.equal(candidate, previousPath);
      return { bytes: previousBytes, value: previous };
    },
    sha256,
    validatePointer(candidate) {
      return candidate;
    }
  }), true);
});

test('specnav core environment overrides cannot execute trusted entry imports', () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-malicious-core-root-')
  );
  const fakeRoot = path.join(workspace, 'specnav-core');
  const marker = path.join(workspace, 'marker');
  const trustedModules = [
    '../../../plugins/specnav-operations/scripts/verification-v2-proof.js',
    (
      '../../../plugins/specnav-operations/scripts/'
      + 'verification-v2-host-artifacts.js'
    )
  ].map((relative) => path.resolve(__dirname, relative));
  fs.mkdirSync(path.join(fakeRoot, '.codex-plugin'), { recursive: true });
  fs.mkdirSync(path.join(fakeRoot, 'scripts'), { recursive: true });
  writeJson(path.join(fakeRoot, '.codex-plugin', 'plugin.json'), {
    name: 'specnav-core'
  });
  fs.writeFileSync(
    path.join(fakeRoot, 'scripts', 'specnav-lib.js'),
    [
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran\\n');`,
      'module.exports = { activeChangeState() { return { change: null }; } };'
    ].join('\n')
  );

  const result = childProcess.spawnSync(process.execPath, [
    '-e',
    'for (const file of process.argv.slice(1)) require(file);',
    ...trustedModules
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECNAV_SPECNAV_CORE_ROOT: fakeRoot
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
});

test('verification plugin root environment overrides cannot replace trusted code', () => {
  const fakeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-malicious-verification-root-')
  );
  const previous = process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT;
  fs.mkdirSync(path.join(fakeRoot, 'kernel'), { recursive: true });
  fs.writeFileSync(
    path.join(fakeRoot, 'kernel', 'index.js'),
    'module.exports = { createHostSandboxPlan() { return {}; } };\n'
  );
  process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT = fakeRoot;
  try {
    const fixture = makeProject();
    const result = fixture.validator.validate(fixture.root, CHANGE);
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
  } finally {
    if (previous === undefined) {
      delete process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT;
    } else {
      process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT = previous;
    }
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
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
  const { value: index } = hostProofArtifact(fixture, 'index');
  index.hosts.push({ ...index.hosts[0] });
  writeHostProofArtifact(fixture, 'index', index);

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:host-installation-index-invalid'),
    true
  );
});

test('duplicate compatibility hosts cannot masquerade as all three hosts', () => {
  const fixture = makeProject();
  const { value: compatibility } = hostProofArtifact(
    fixture,
    'compatibility'
  );
  compatibility.hosts = [
    { ...compatibility.hosts[0] },
    { ...compatibility.hosts[0] },
    { ...compatibility.hosts[0] }
  ];
  writeHostProofArtifact(fixture, 'compatibility', compatibility);

  const result = fixture.validator.validate(fixture.root, CHANGE);
  assert.equal(result.ok, false);
  assert.equal(
    blockers(result).has('verification-release:cross-host-compatibility-blocked'),
    true
  );
});

test('host receipts and compatibility cannot be replayed across gate inputs', () => {
  const fixture = makeProject();
  const { value: index } = hostProofArtifact(fixture, 'index');
  const codex = index.hosts.find((entry) => entry.host === 'codex');
  const receiptFile = path.join(fixture.changeDir, codex.receipt_path);
  const receipt = readJson(receiptFile);
  receipt.release_gate_id = 'gate-from-an-older-release';
  writeJson(receiptFile, receipt);
  codex.receipt_sha256 = sha256(fs.readFileSync(receiptFile));
  writeHostProofArtifact(fixture, 'index', index);

  const { value: compatibility } = hostProofArtifact(
    fixture,
    'compatibility'
  );
  compatibility.gate_input_sha256 = '0'.repeat(64);
  writeHostProofArtifact(fixture, 'compatibility', compatibility);

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
