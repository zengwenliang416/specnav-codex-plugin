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
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');
const {
  reportModel
} = require('../reports/report-test-helpers');
const {
  createReleaseProofValidator
} = require('../../../plugins/specnav-operations/scripts/verification-v2-proof');

const CHANGE = 'release-proof-change';
const CASE_ID = 'case-release-proof';
const HOSTS = ['claude-code', 'codex', 'codefree-o'];

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
    runtime_version: '2.0.0',
    kernel_version: '2.0.0-alpha.1',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    domain: source.domain
  };
}

function aggregationRequest() {
  const readings = SIX_DOMAINS.map(reading);
  const evidenceEntries = readings.map(evidence);
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
        }))
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
  return {
    schema: 'specnav.verification.release-gate-input.v1',
    change_id: CHANGE,
    lane: 'standard',
    case_snapshot_id: 'snapshot-release',
    case_snapshot_hash: 'a'.repeat(64),
    case_approval_id: 'approval-release',
    aggregation_request: aggregationRequest(),
    open_failure_ids: [],
    freshness: {
      status: 'fresh',
      checked_at: '2026-08-02T00:00:03Z',
      reasons: []
    },
    integrity_status: 'intact',
    evidence_index_version: 7,
    runtime_version: '2.0.0',
    kernel_version: '2.0.0-alpha.1',
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

function makeProject() {
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
  const input = gateInput();
  const releaseGate = createGate(schemaRegistry, input, 'release');
  const archiveGate = createGate(schemaRegistry, input, 'archive');
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
  const snapshot = {
    schema: 'specnav.verification.case-snapshot.v1',
    id: input.case_snapshot_id,
    change_id: CHANGE,
    snapshot_hash: input.case_snapshot_hash,
    cases: [testCase()],
    created_at: '2026-08-02T00:00:00Z',
    created_by: reviewer(),
    requirements_hash: '5'.repeat(64),
    acceptance_hash: '6'.repeat(64)
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
  const model = reportModel('green', {
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
      aggregate_id: releaseGate.id.replace(/^gate-/, 'verification-aggregate-'),
      gate_decision_id: releaseGate.id
    },
    summary: {
      ...reportModel('green').summary,
      runtime_version: input.runtime_version,
      kernel_version: input.kernel_version
    }
  });

  writeJson(path.join(verifyV2, 'case-snapshot.json'), snapshot);
  writeJson(path.join(verifyV2, 'case-approval.json'), approval);
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
  for (const name of [
    'overview.html',
    'test-case-catalog.html',
    'test-case-results.html'
  ]) {
    fs.writeFileSync(path.join(reportsDir, name), `<!doctype html><title>${name}</title>\n`);
  }

  const releaseBindings = {
    change_id: CHANGE,
    release_gate_id: releaseGate.id,
    archive_gate_id: archiveGate.id,
    gate_input_sha256: sha256(
      fs.readFileSync(path.join(verifyV2, 'gate-input.json'))
    ),
    evidence_index_digest: evidenceIndex.source_digest
  };
  const records = HOSTS.map((host, index) => {
    const receiptPath = path.join('operations', 'install-receipts', `${host}.json`);
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

  return {
    root,
    changeDir,
    verifyV2,
    reportsDir,
    opsDir,
    schemaRegistry,
    validator: createReleaseProofValidator({
      schemaRegistry,
      clock: () => '2026-08-02T00:00:07Z'
    })
  };
}

function blockers(result) {
  return new Set(result.blockers.map((entry) => entry.id));
}

test('complete Kernel-derived release and archive proof passes and writes digests', () => {
  const fixture = makeProject();
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
