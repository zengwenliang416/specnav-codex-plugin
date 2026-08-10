#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const kernel = require('../../../plugins/specnav-verification/kernel');
const {
  createCaseApprovalValidator,
  createCasePlanner,
  createCaseSnapshotWriter
} = require('../../../plugins/specnav-verification/kernel/cases');
const {
  loadRuntimeLock
} = require('../../../plugins/specnav-verification/kernel/runtime/lock-manifest');
const {
  doctorRuntime
} = require('../../../plugins/specnav-verification/kernel/runtime/doctor');
const {
  runtimeBaseDefault
} = require('../../../plugins/specnav-verification/kernel/runtime/installer');
const {
  createTrustedFactAuthority
} = require('../../../plugins/specnav-verification/kernel/repair');
const {
  mergeIntegrityResults
} = require('../../../plugins/specnav-verification/kernel/pipeline/production-runner');
const {
  HOST_DESCRIPTORS,
  expectedHostCommands
} = require('../../../plugins/specnav-operations/scripts/verification-v2-host-contract');
const { readySchemaRegistry } = require('../contracts/cross-reference/test-helpers');

const HOSTS = Object.freeze(['claude-code', 'codex', 'codefree-o']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
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

function ensureFixtureRepository(root) {
  if (!fs.existsSync(path.join(root, '.git'))) {
    const ignoreFile = path.join(root, '.gitignore');
    const current = fs.existsSync(ignoreFile)
      ? fs.readFileSync(ignoreFile, 'utf8')
      : '';
    const lines = current.split(/\r?\n/).filter(Boolean);
    if (!lines.includes('/openspec/')) lines.push('/openspec/');
    fs.writeFileSync(ignoreFile, `${lines.join('\n')}\n`);
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'SpecNav Fixture']);
    git(root, ['config', 'user.email', 'specnav-fixture@example.invalid']);
    git(root, ['add', '.gitignore']);
    git(root, ['commit', '--quiet', '-m', 'test: initialize fixture repository']);
  }
  const status = git(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ]);
  if (status.trim() !== '') {
    throw new Error(`verification-fixture:dirty-worktree:${status.trim()}`);
  }
}

function currentFingerprints(root, snapshot, runtimeStatus, runtimeAuthority) {
  const repositoryInventory = git(root, [
    'ls-tree',
    '-r',
    'HEAD'
  ]);
  const testInventory = git(root, [
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
        runtime_authority_hash: runtimeAuthority.digest,
        kernel_version: kernel.metadata.version
      }))
      .digest('hex'),
    runtime_version: runtimeStatus.runtime_version,
    kernel_version: kernel.metadata.version
  };
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

function reading(change, caseId, domain, fingerprints) {
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
    code_sha: fingerprints.code_sha,
    test_sha: fingerprints.test_sha
  };
}

function evidence(change, caseId, source, fingerprints) {
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
    environment_hash: fingerprints.environment_hash,
    runtime_version: fingerprints.runtime_version,
    kernel_version: fingerprints.kernel_version,
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    domain: source.domain
  };
}

function loadHostLock(lockFile) {
  if (typeof lockFile !== 'string' || lockFile.trim() === '') {
    throw new Error('verification-fixture:host-lock-required');
  }
  const file = fs.realpathSync(path.resolve(lockFile));
  const bytes = fs.readFileSync(file);
  const lock = JSON.parse(bytes.toString('utf8'));
  const commits = {
    codex: lock.source?.commit,
    'claude-code': lock.hosts?.['claude-code']?.commit,
    'codefree-o': lock.hosts?.['codefree-o']?.commit
  };
  for (const host of HOSTS) {
    if (!/^[a-f0-9]{40}$/.test(commits[host] || '')) {
      throw new Error(`verification-fixture:host-lock-invalid:${host}`);
    }
  }
  return { bytes, commits, file, lock };
}

function populateProject(projectRoot, change, options = {}) {
  const root = path.resolve(projectRoot);
  const changeDir = path.join(root, 'openspec', 'changes', change);
  const verifyV2 = path.join(changeDir, 'verify', 'v2');
  const opsDir = path.join(changeDir, 'operations');
  const caseId = `case-${change}`;
  const approvalId = `approval-${change}`;
  const reviewerId = 'reviewer-release';
  const reviewer = { id: reviewerId, kind: 'human' };
  const schemaRegistry = readySchemaRegistry();
  const requirements = [{
    id: 'REQ-1',
    statement: 'The release proof uses current approved requirements.'
  }];
  const acceptance = [{
    id: 'AC-1',
    statement: 'All six domains and release provenance pass.'
  }];
  const plan = createCasePlanner({ schemaRegistry }).plan({
    changeId: change,
    requirements,
    acceptance,
    cases: [testCase(change, caseId)]
  });
  if (!plan.ok) {
    throw new Error(JSON.stringify(plan.blockers));
  }
  const snapshotResult = createCaseSnapshotWriter({
    schemaRegistry
  }).create({
    plan,
    createdAt: '2026-08-02T00:00:00Z',
    createdBy: reviewer
  });
  if (!snapshotResult.ok) {
    throw new Error(JSON.stringify(snapshotResult.blockers));
  }
  const snapshot = snapshotResult.snapshot;
  const approval = {
    schema: 'specnav.verification.case-approval.v1',
    id: approvalId,
    change_id: change,
    snapshot_id: snapshot.id,
    snapshot_hash: snapshot.snapshot_hash,
    decision: 'approved',
    reviewer,
    decided_at: '2026-08-02T00:00:01Z'
  };
  const approvalState = createCaseApprovalValidator({
    schemaRegistry
  }).assertExecutionApproved({
    snapshot,
    approval,
    currentRequirements: plan.requirements,
    currentAcceptance: plan.acceptance,
    expectedReviewerId: reviewerId
  });
  if (!approvalState.ok) {
    throw new Error(JSON.stringify(approvalState.blockers));
  }
  ensureFixtureRepository(root);
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
  const runtimeResolution = kernel.createRuntimeAuthority().resolve(
    runtimeStatus
  );
  if (!runtimeResolution.ok || !runtimeResolution.signingKey) {
    throw new Error(JSON.stringify(runtimeResolution.blockers));
  }
  const fingerprints = currentFingerprints(
    root,
    snapshot,
    runtimeResolution.runtimeStatus,
    runtimeResolution.authority
  );
  const trustedFactAuthority = createTrustedFactAuthority({
    schemaRegistry,
    key: runtimeResolution.signingKey,
    clock: () => '2026-08-02T00:00:03Z'
  });
  const hostLock = loadHostLock(
    options.hostLockFile || process.env.SPECNAV_VERIFICATION_HOST_LOCK
  );
  const hostCommits = hostLock.commits;
  const readings = kernel.SIX_DOMAINS.map((domain) => (
    reading(change, caseId, domain, fingerprints)
  ));
  const evidenceEntries = readings.map((entry) => (
    evidence(change, caseId, entry, fingerprints)
  )).sort((left, right) => (
    left.captured_at.localeCompare(right.captured_at)
      || left.id.localeCompare(right.id)
  ));
  const run = {
    schema: 'specnav.verification.run.v1',
    id: 'run-release',
    change_id: change,
    case_snapshot_id: snapshot.id,
    case_snapshot_hash: snapshot.snapshot_hash,
    case_ids: [caseId],
    ...fingerprints,
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
    change_id: change,
    case_id: caseId,
    case_snapshot_hash: snapshot.snapshot_hash,
    kind: 'initial',
    sequence: 1,
    runner: 'command',
    code_sha: fingerprints.code_sha,
    test_sha: fingerprints.test_sha,
    scenario_hash: '5'.repeat(64),
    environment_hash: fingerprints.environment_hash,
    browser_project: 'none',
    test_data_snapshot: '6'.repeat(64),
    runtime_version: fingerprints.runtime_version,
    kernel_version: fingerprints.kernel_version,
    status: 'passed',
    started_at: run.started_at,
    completed_at: run.completed_at,
    exit_status: 0,
    parent_attempt_id: null
  };
  const evidenceFacts = evidenceEntries.map((entry) => ({
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
  })).sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  const attemptIntegrity = {
    ok: true,
    facts: {
      summary: {
        evidence_count: evidenceFacts.length,
        integrity: 'intact',
        freshness: 'fresh'
      },
      evidence: evidenceFacts
    },
    blockers: []
  };
  const runIntegrity = mergeIntegrityResults([attemptIntegrity]);
  const rawBytes = Buffer.from(
    `${evidenceEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  const evidenceIndex = {
    schema: 'specnav.verification.evidence-index.v1',
    index_version: evidenceEntries.length,
    change_id: change,
    generated_at: '2026-08-02T00:00:01Z',
    source_raw: 'raw.jsonl',
    source_digest: sha256(rawBytes),
    record_count: evidenceEntries.length,
    entries: evidenceEntries
  };

  writeJson(path.join(verifyV2, 'runtime-status.json'), runtimeStatus);
  writeJson(
    path.join(verifyV2, 'requirements-source.json'),
    plan.requirements
  );
  writeJson(
    path.join(verifyV2, 'acceptance-source.json'),
    plan.acceptance
  );
  writeJson(path.join(verifyV2, 'case-snapshot.json'), snapshot);
  writeJson(path.join(verifyV2, 'case-approval.json'), approval);
  writeJson(path.join(verifyV2, 'runs.json'), [run]);
  writeJson(path.join(verifyV2, 'attempts.json'), [attempt]);
  writeJson(path.join(verifyV2, 'readings.json'), readings);
  writeJson(path.join(verifyV2, 'failures.json'), []);
  writeJson(path.join(verifyV2, 'repair-links.json'), []);
  for (const name of [
    'transition-proposals.jsonl',
    'transition-receipts.jsonl',
    'attempt-facts.jsonl'
  ]) {
    fs.mkdirSync(verifyV2, { recursive: true });
    fs.writeFileSync(path.join(verifyV2, name), '');
  }
  const runDir = path.join(changeDir, 'verify', 'runs', run.id);
  writeJson(
    path.join(runDir, 'attempts', attempt.id, 'integrity.json'),
    attemptIntegrity
  );
  writeJson(path.join(runDir, 'integrity.json'), runIntegrity);
  fs.writeFileSync(path.join(runDir, 'failures.jsonl'), '');
  fs.mkdirSync(path.join(changeDir, 'verify', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'verify', 'evidence', 'raw.jsonl'), rawBytes);
  writeJson(path.join(changeDir, 'verify', 'evidence', 'index.json'), evidenceIndex);
  const canonical = kernel.createVerificationArtifactPipeline({
    kernel,
    schemaRegistry,
    changeRoot: changeDir,
    verificationRoot: path.join(changeDir, 'verify'),
    snapshot,
    approval,
    currentFingerprints: fingerprints,
    trustedFactAuthority,
    clock: () => '2026-08-02T00:00:03Z',
    secrets: [],
    policyVersion: 'verification-v2.0'
  }).build();
  if (!canonical.ok) {
    throw new Error(JSON.stringify(canonical.blockers));
  }
  const input = canonical.gate_input;
  const releaseGate = canonical.release_gate;
  const archiveGate = canonical.archive_gate;
  writeJson(path.join(verifyV2, 'migration-status.json'), {
    schema: 'specnav.verification.migration-status.v1',
    change_id: change,
    required: false,
    legacy_artifacts: [],
    source_inventory_digest: 'c'.repeat(64),
    scanned_at: '2026-08-02T00:00:00Z',
    fallback_used: false
  });

  const releaseBindings = {
    change_id: change,
    release_gate_id: releaseGate.id,
    archive_gate_id: archiveGate.id,
    gate_input_sha256: sha256(
      fs.readFileSync(path.join(verifyV2, 'gate-input.json'))
    ),
    evidence_index_digest: evidenceIndex.source_digest
  };
  const hostAuthority = kernel.createHostCompatibilityAuthority({
    lockFile: hostLock.file,
    fixtureRoot: options.fixtureRoot
      || process.env.SPECNAV_VERIFICATION_FIXTURE_ROOT,
    descriptors: HOST_DESCRIPTORS,
    sourceHost: 'codex',
    roots: options.hostRoots || {
      codex: process.env.SPECNAV_CODEX_REPOSITORY_ROOT,
      'claude-code': process.env.SPECNAV_CLAUDE_REPOSITORY_ROOT,
      'codefree-o': process.env.SPECNAV_CODEFREE_O_REPOSITORY_ROOT
    }
  }).resolve();
  if (!hostAuthority.ok) {
    throw new Error(JSON.stringify(hostAuthority.blockers));
  }
  const hosts = HOSTS.map((host) => {
    const receiptPath = `operations/install-receipts/${host}.json`;
    const locked = host === 'codex'
      ? hostAuthority.lock.source
      : hostAuthority.lock.hosts[host];
    const commandArgv = expectedHostCommands(
      host,
      hostAuthority.roots[host],
      locked,
      {},
      {
        managedRuntimeProbe: path.join(
          __dirname,
          '../../../plugins/specnav-verification/scripts/verification-runtime.js'
        ),
        runtimeBase: path.dirname(runtimeStatus.runtime_root),
        runtimeVersion: runtimeStatus.runtime_version
      }
    );
    const commands = commandArgv.map((argv, index) => {
      const stdoutPath = `operations/install-receipts/logs/${host}-${index + 1}.stdout.log`;
      const stderrPath = `operations/install-receipts/logs/${host}-${index + 1}.stderr.log`;
      const stdout = Buffer.from(`completed ${argv.join(' ')}\n`);
      const stderr = Buffer.alloc(0);
      fs.mkdirSync(path.dirname(path.join(changeDir, stdoutPath)), {
        recursive: true
      });
      fs.writeFileSync(path.join(changeDir, stdoutPath), stdout);
      fs.writeFileSync(path.join(changeDir, stderrPath), stderr);
      return {
        argv,
        exit_status: 0,
        stdout_sha256: sha256(stdout),
        stderr_sha256: sha256(stderr),
        stdout_path: stdoutPath,
        stderr_path: stderrPath
      };
    });
    const receipt = {
      schema: 'specnav.verification.host-install-receipt.v1',
      host,
      ...releaseBindings,
      host_lock_sha256: hostAuthority.summary.lock_sha256,
      repository: locked.repository,
      commit: hostCommits[host],
      remote_commit_reachable: true,
      checkout_realpath: hostAuthority.roots[host],
      plugin_realpath: path.join(
        hostAuthority.roots[host],
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
        commands,
        environment_sha256: 'b'.repeat(64),
        started_at: '2026-08-02T00:00:05Z',
        completed_at: '2026-08-02T00:00:06Z'
      },
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
    host_lock_sha256: hostAuthority.summary.lock_sha256,
    hosts,
    fallback_used: false
  });
  writeJson(path.join(opsDir, 'cross-host-compatibility.json'), {
    schema: 'specnav.verification.cross-host-release-result.v1',
    ...releaseBindings,
    host_lock_sha256: hostAuthority.summary.lock_sha256,
    authority_digest: hostAuthority.summary.digest,
    comparison_digest: hostAuthority.summary.comparison,
    ok: true,
    hosts: hosts.map((entry) => ({
      host: entry.host,
      commit: entry.commit,
      snapshot_digest: hostAuthority.summary.snapshots[entry.host],
      receipt_sha256: entry.receipt_sha256
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
