'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  run,
  validateRepairDiff,
  repairCompletionFingerprints
} = require('../../../plugins/specnav-verification/scripts/verification-v2-repair-loop');
const {
  createTrustedFactAuthority
} = require('../../../plugins/specnav-verification/kernel/repair/trusted-fact-authority');
const verificationKernel = require(
  '../../../plugins/specnav-verification/kernel'
);
const {
  canonicalJson,
  sha256
} = require('../../../plugins/specnav-verification/kernel/evidence/identity');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../contracts/fixtures'
);
const FIXED_TIME = '2026-08-06T09:00:00.000Z';

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(
    FIXTURE_ROOT,
    name
  ), 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function projectFixture() {
  const projectRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-repair-cli-'
  ));
  const changeId = 'change-v2';
  const changeRoot = path.join(projectRoot, 'openspec', 'changes', changeId);
  const verificationRoot = path.join(changeRoot, 'verify');
  const v2 = path.join(verificationRoot, 'v2');
  fs.mkdirSync(path.join(
    projectRoot,
    'openspec',
    '.specnav'
  ), { recursive: true });
  fs.writeFileSync(path.join(
    projectRoot,
    'openspec',
    '.specnav',
    'active-change'
  ), `${changeId}\n`);

  const snapshot = fixture('positive/case-snapshot.json');
  const approval = fixture('positive/case-approval.json');
  const runtimeStatus = fixture('positive/runtime-status.json');
  const runValue = {
    ...fixture('positive/verification-run.json'),
    kernel_version: verificationKernel.metadata.version
  };
  const attempt = {
    ...fixture('positive/attempt.json'),
    status: 'failed',
    exit_status: 1,
    kernel_version: verificationKernel.metadata.version
  };
  const reading = {
    ...fixture('positive/reading.json'),
    actual: false,
    verdict: 'fail'
  };
  delete reading.step_id;
  reading.assertion_id = 'assertion-1';
  const evidence = {
    ...fixture('ac31/evidence-baseline.json'),
    kernel_version: verificationKernel.metadata.version
  };
  delete evidence.step_id;
  evidence.assertion_id = 'assertion-1';
  const failure = {
    ...fixture('positive/failure-packet.json'),
    classification: null,
    status: 'open',
    next_action: 'blocked_for_decision',
    owner: 'verification'
  };
  const evidenceIndex = {
    ...fixture('positive/evidence-index.json'),
    record_count: 1,
    entries: [evidence]
  };
  const integrity = {
    ok: true,
    facts: {
      summary: {
        evidence_count: 1,
        integrity: 'intact',
        freshness: 'fresh'
      },
      evidence: [{
        evidence_id: evidence.id,
        integrity: 'intact',
        freshness: 'fresh',
        binding_match: true,
        exists: true,
        hash_match: true,
        size_match: true,
        producer_recognized: true,
        store_record_match: true,
        path_safe: true
      }]
    },
    blockers: []
  };
  for (const [name, value] of Object.entries({
    'case-snapshot.json': snapshot,
    'case-approval.json': approval,
    'requirements-source.json': [{
      id: 'REQ-1',
      statement: 'The contract is validated.'
    }],
    'acceptance-source.json': [{
      id: 'AC-13',
      statement: 'The approved case remains verifiable.'
    }],
    'runtime-status.json': runtimeStatus,
    'runs.json': [runValue],
    'attempts.json': [attempt],
    'readings.json': [reading],
    'failures.json': [failure]
  })) {
    writeJson(path.join(v2, name), value);
  }
  writeJson(path.join(
    verificationRoot,
    'evidence',
    'index.json'
  ), evidenceIndex);
  writeJson(path.join(
    verificationRoot,
    'runs',
    runValue.id,
    'attempts',
    attempt.id,
    'integrity.json'
  ), integrity);
  fs.mkdirSync(path.join(
    verificationRoot,
    'runs',
    runValue.id
  ), { recursive: true });
  fs.writeFileSync(path.join(
    verificationRoot,
    'runs',
    runValue.id,
    'failures.jsonl'
  ), `${JSON.stringify(failure)}\n`);

  const rootCauseFile = path.join(changeRoot, 'root-cause-check.json');
  writeJson(rootCauseFile, {
    schema: 'specnav.verification.root-cause-review.v1',
    id: 'root-cause-check-cli',
    failure_id: failure.id,
    root_failure_digest: sha256(canonicalJson(failure)),
    change_id: changeId,
    run_id: runValue.id,
    case_id: failure.case_id,
    attempt_id: failure.attempt_id,
    classification: 'test_defect',
    summary: 'The test harness produced an invalid result.',
    root_cause: 'The test code must be repaired before a trusted retest.',
    failed_assertion_ids: [...failure.failed_assertion_ids],
    reviewer: {
      id: 'reviewer-1',
      kind: 'human'
    },
    decision: 'approved',
    reviewed_at: FIXED_TIME
  });
  const scopeFile = path.join(changeRoot, 'repair-scope.json');
  writeJson(scopeFile, {
    allowed_files: ['tests/specnav/**'],
    denied_files: ['openspec/changes/archive/**'],
    requires_review_on: ['tests/specnav/**'],
    allowed_operations: {
      create: true,
      modify: true,
      delete: false,
      rename: false
    }
  });
  return {
    projectRoot,
    changeId,
    failure,
    attempt,
    rootCauseFile,
    scopeFile,
    verificationRoot
  };
}

function dependencies() {
  const schemaRegistry = readySchemaRegistry();
  return {
    schemaRegistry,
    clock: () => FIXED_TIME,
    createSchemaRegistry: () => schemaRegistry,
    runtimeAuthority: {
      resolve(runtimeStatus) {
        return {
          ok: true,
          runtimeRoot: runtimeStatus.runtime_root,
          runtimeStatus,
          authority: {
            schema: 'specnav.verification.runtime-authority.v1',
            digest: 'a'.repeat(64)
          },
          signingKey: Buffer.alloc(32, 23),
          blockers: []
        };
      }
    }
  };
}

function writeRepairReview({
  source,
  taskId,
  link,
  afterIdentity,
  kind,
  reviewerId
}) {
  const taskRoot = path.join(
    source.projectRoot,
    'openspec',
    'changes',
    source.changeId,
    'development',
    'tasks',
    taskId
  );
  const file = path.join(taskRoot, `${kind}.json`);
  writeJson(file, {
    schema: 'specnav.verification.repair-review.v1',
    id: `${kind}-cli`,
    kind,
    verdict: 'approved',
    reviewer_id: reviewerId,
    reviewer_kind: 'human',
    reviewed_at: FIXED_TIME,
    evidence_id: `${kind}-evidence-cli`,
    task_id: taskId,
    failure_id: source.failure.id,
    repair_link_id: link.id,
    repair_link_digest: sha256(canonicalJson(link)),
    scope_digest: link.scope_digest,
    after_identity_digest: sha256(canonicalJson(afterIdentity))
  });
  return file;
}

function git(root, args) {
  const result = childProcess.spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function baseArgs(source, action) {
  return [
    action,
    '--project',
    source.projectRoot,
    '--change',
    source.changeId,
    '--reviewer-id',
    'reviewer-1',
    '--failure-id',
    source.failure.id
  ];
}

test('repair CLI replays classification and repair request without overwriting task review files', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const classifyArgs = [
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ];
  const firstClassification = await run(classifyArgs, deps);
  const replayedClassification = await run(classifyArgs, deps);

  assert.equal(
    firstClassification.ok,
    true,
    JSON.stringify(firstClassification.blockers)
  );
  assert.equal(replayedClassification.ok, true);
  assert.equal(replayedClassification.replayed, true);
  assert.equal(
    replayedClassification.envelope_id,
    firstClassification.envelope_id
  );

  const repairArgs = [
    ...baseArgs(source, 'repair-request'),
    '--scope',
    path.relative(source.projectRoot, source.scopeFile)
  ];
  const requested = await run(repairArgs, deps);
  assert.equal(requested.ok, true, JSON.stringify(requested.blockers));
  const reviewFile = path.join(
    source.projectRoot,
    'openspec',
    'changes',
    source.changeId,
    'development',
    'tasks',
    requested.development_task_id,
    'spec-review.md'
  );
  fs.writeFileSync(reviewFile, '# Spec Review\n\napproved by reviewer\n');

  const replayedRequest = await run(repairArgs, deps);
  assert.equal(
    replayedRequest.ok,
    true,
    JSON.stringify(replayedRequest.blockers)
  );
  assert.equal(replayedRequest.replayed, true);
  assert.equal(
    fs.readFileSync(reviewFile, 'utf8'),
    '# Spec Review\n\napproved by reviewer\n'
  );
});

test('repair CLI appends one deterministic proposal across repeated state evaluation', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const classify = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classify.ok, true, JSON.stringify(classify.blockers));

  const first = await run(baseArgs(source, 'state'), deps);
  const second = await run(baseArgs(source, 'state'), deps);
  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(second.ok, true, JSON.stringify(second.blockers));
  assert.equal(
    first.transition_proposal.id,
    second.transition_proposal.id
  );

  const lines = fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'transition-proposals.jsonl'
  ), 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const proposalEnvelope = JSON.parse(lines[0]);
  assert.equal(
    proposalEnvelope.payload.id,
    first.transition_proposal.id
  );
  assert.equal(proposalEnvelope.bindings.log_sequence, 1);
  assert.equal(
    proposalEnvelope.bindings.previous_envelope_digest,
    null
  );
});

test('repair CLI starts from a clean baseline and completes only after scoped changes', async () => {
  const source = projectFixture();
  const baselineIdentity = {
    case_snapshot_hash: source.attempt.case_snapshot_hash,
    code_sha: source.attempt.code_sha,
    test_sha: source.attempt.test_sha,
    environment_hash: source.attempt.environment_hash,
    runtime_version: source.attempt.runtime_version,
    kernel_version: source.attempt.kernel_version
  };
  const afterIdentity = {
    ...baselineIdentity,
    test_sha: 'e'.repeat(64)
  };
  let fingerprintCall = 0;
  const deps = {
    ...dependencies(),
    fingerprints() {
      const value = fingerprintCall === 0 ? baselineIdentity : afterIdentity;
      fingerprintCall += 1;
      return {
        codeSha: value.code_sha,
        testSha: value.test_sha,
        environmentHash: value.environment_hash
      };
    },
    validateRepairDiff() {
      return {
        ok: true,
        status: 'scope_verified',
        changes: [{
          status: 'M',
          file: 'tests/specnav/repair.test.js'
        }],
        blockers: [],
        fallback_used: false
      };
    }
  };
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));
  const requested = await run([
    ...baseArgs(source, 'repair-request'),
    '--scope',
    path.relative(source.projectRoot, source.scopeFile)
  ], deps);
  assert.equal(requested.ok, true, JSON.stringify(requested.blockers));
  const started = await run(baseArgs(source, 'repair-start'), deps);
  assert.equal(started.ok, true, JSON.stringify(started.blockers));
  assert.deepEqual(started.baseline_identity, baselineIdentity);

  const link = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id,
    'repair-link.json'
  ), 'utf8'));
  const specReview = writeRepairReview({
    source,
    taskId: requested.development_task_id,
    link,
    afterIdentity,
    kind: 'spec-review',
    reviewerId: 'spec-reviewer'
  });
  const qualityReview = writeRepairReview({
    source,
    taskId: requested.development_task_id,
    link,
    afterIdentity,
    kind: 'quality-review',
    reviewerId: 'quality-reviewer'
  });
  const completed = await run([
    ...baseArgs(source, 'repair-complete'),
    '--spec-review',
    path.relative(source.projectRoot, specReview),
    '--quality-review',
    path.relative(source.projectRoot, qualityReview)
  ], deps);
  assert.equal(completed.ok, true, JSON.stringify(completed.blockers));
  assert.equal(completed.status, 'repair_completed');
  assert.deepEqual(completed.after_identity, afterIdentity);
  assert.deepEqual(completed.verified_changes, [{
    status: 'M',
    file: 'tests/specnav/repair.test.js'
  }]);
  assert.equal(completed.fallback_used, false);
});

test('repair CLI blocks start when the original failure fingerprint drifted', async () => {
  const source = projectFixture();
  const deps = {
    ...dependencies(),
    fingerprints() {
      return {
        codeSha: 'f'.repeat(40),
        testSha: source.attempt.test_sha,
        environmentHash: source.attempt.environment_hash
      };
    }
  };
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));
  const requested = await run([
    ...baseArgs(source, 'repair-request'),
    '--scope',
    path.relative(source.projectRoot, source.scopeFile)
  ], deps);
  assert.equal(requested.ok, true, JSON.stringify(requested.blockers));

  const started = await run(baseArgs(source, 'repair-start'), deps);
  assert.equal(started.ok, false);
  assert.deepEqual(
    started.blockers.map((entry) => entry.id),
    ['verification-repair:repair-baseline-drift']
  );
  assert.equal(started.blockers[0].detail, 'code_sha');
  assert.equal(fs.existsSync(path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id,
    'repair-link-started-envelope.json'
  )), false);
});

test('repair CLI blocks replayed repair envelopes with replaced lineage', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));
  const requested = await run([
    ...baseArgs(source, 'repair-request'),
    '--scope',
    path.relative(source.projectRoot, source.scopeFile)
  ], deps);
  assert.equal(requested.ok, true, JSON.stringify(requested.blockers));

  const repairRoot = path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id
  );
  const requestedEnvelope = JSON.parse(fs.readFileSync(path.join(
    repairRoot,
    'repair-link-requested-envelope.json'
  ), 'utf8'));
  const authority = createTrustedFactAuthority({
    schemaRegistry: deps.schemaRegistry,
    key: Buffer.alloc(32, 23),
    clock: () => FIXED_TIME
  });
  const envelopeBindings = {
    failure_id: source.failure.id,
    change_id: source.failure.change_id,
    run_id: source.failure.run_id,
    case_id: source.failure.case_id
  };
  const replacedIdentity = {
    ...requestedEnvelope.payload.before_identity,
    code_sha: 'f'.repeat(40)
  };
  const startedEnvelope = authority.seal('repair_link', {
    ...requestedEnvelope.payload,
    status: 'in_progress',
    before_identity: replacedIdentity
  }, envelopeBindings);
  writeJson(path.join(
    repairRoot,
    'repair-link-started-envelope.json'
  ), startedEnvelope);

  const replayedStart = await run(baseArgs(source, 'repair-start'), {
    ...deps,
    fingerprints() {
      return {
        codeSha: source.attempt.code_sha,
        testSha: source.attempt.test_sha,
        environmentHash: source.attempt.environment_hash
      };
    }
  });
  assert.equal(replayedStart.ok, false);
  assert.deepEqual(
    replayedStart.blockers.map((entry) => entry.id),
    ['verification-repair:repair-baseline-invalid']
  );
  assert.equal(replayedStart.blockers[0].detail, 'before_identity');

  fs.rmSync(path.join(
    repairRoot,
    'repair-link-started-envelope.json'
  ));
  const completedEnvelope = authority.seal('repair_link', {
    ...requestedEnvelope.payload,
    status: 'completed',
    completed_at: FIXED_TIME,
    before_identity: replacedIdentity,
    after_identity: {
      ...replacedIdentity,
      test_sha: 'e'.repeat(64)
    },
    review_evidence_ids: [
      'quality-review-evidence',
      'spec-review-evidence'
    ]
  }, envelopeBindings);
  writeJson(path.join(
    repairRoot,
    'repair-link-completed-envelope.json'
  ), completedEnvelope);

  const replayedCompletion = await run(
    baseArgs(source, 'repair-complete'),
    deps
  );
  assert.equal(replayedCompletion.ok, false);
  assert.deepEqual(
    replayedCompletion.blockers.map((entry) => entry.id),
    ['verification-repair:repair-link-envelope-invalid']
  );
  assert.equal(
    replayedCompletion.blockers[0].detail,
    'before_identity'
  );
});

test('repair request replay rejects a link that replaced failure identity', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const classifyArgs = [
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ];
  const repairArgs = [
    ...baseArgs(source, 'repair-request'),
    '--scope',
    path.relative(source.projectRoot, source.scopeFile)
  ];
  const classified = await run(classifyArgs, deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));
  const requested = await run(repairArgs, deps);
  assert.equal(requested.ok, true, JSON.stringify(requested.blockers));

  const linkFile = path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id,
    'repair-link.json'
  );
  const link = JSON.parse(fs.readFileSync(linkFile, 'utf8'));
  writeJson(linkFile, {
    ...link,
    before_identity: {
      ...link.before_identity,
      code_sha: 'f'.repeat(40)
    }
  });

  const replayed = await run(repairArgs, deps);
  assert.equal(replayed.ok, false);
  assert.deepEqual(
    replayed.blockers.map((entry) => entry.id),
    ['verification-repair:repair-link-invalid']
  );
  assert.equal(replayed.blockers[0].detail, 'code_sha');
});

test('repair diff accepts lifecycle artifacts but rejects scope escape', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-repair-diff-'
  ));
  const changeId = 'change-v2';
  const failureId = 'failure-cli';
  const taskId = '900-verification-repair-cli';
  fs.mkdirSync(path.join(root, 'tests', 'specnav'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(
    root,
    'openspec',
    'changes',
    changeId,
    'development',
    'tasks',
    taskId
  ), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'specnav', 'repair.test.js'), 'a\n');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'a\n');
  fs.writeFileSync(path.join(
    root,
    'openspec',
    'changes',
    changeId,
    'development',
    'tasks',
    taskId,
    'report.md'
  ), 'pending\n');
  git(root, ['init']);
  git(root, ['config', 'user.email', 'specnav@example.test']);
  git(root, ['config', 'user.name', 'SpecNav Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'baseline']);
  const baseline = git(root, ['rev-parse', 'HEAD']);

  fs.writeFileSync(path.join(root, 'tests', 'specnav', 'repair.test.js'), 'b\n');
  fs.writeFileSync(path.join(
    root,
    'openspec',
    'changes',
    changeId,
    'development',
    'tasks',
    taskId,
    'report.md'
  ), 'approved\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'scoped repair']);
  const scopedHead = git(root, ['rev-parse', 'HEAD']);
  const task = {
    id: taskId,
    scope: {
      allowed_files: ['tests/specnav/**'],
      denied_files: ['openspec/changes/archive/**'],
      allowed_operations: {
        create: true,
        modify: true,
        delete: false,
        rename: false
      }
    }
  };
  const accepted = validateRepairDiff({
    projectRoot: root,
    changeId,
    failureId,
    task,
    beforeIdentity: { code_sha: baseline },
    afterIdentity: { code_sha: scopedHead }
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.blockers));
  assert.deepEqual(accepted.changes, [{
    status: 'M',
    file: 'tests/specnav/repair.test.js'
  }]);

  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'b\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'scope escape']);
  const escapedHead = git(root, ['rev-parse', 'HEAD']);
  const rejected = validateRepairDiff({
    projectRoot: root,
    changeId,
    failureId,
    task,
    beforeIdentity: { code_sha: baseline },
    afterIdentity: { code_sha: escapedHead }
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual(
    rejected.blockers.map((entry) => entry.id),
    ['verification-repair:scope-diff-outside-lock']
  );
});

test('repair completion fingerprints allow only the named review receipts', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-repair-fingerprint-'
  ));
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'specnav-verification'), {
    recursive: true
  });
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'change-v2'), {
    recursive: true
  });
  fs.writeFileSync(path.join(root, 'tests', 'repair.test.js'), 'ok\n');
  fs.writeFileSync(
    path.join(root, 'plugins', 'specnav-verification', 'runtime.js'),
    'ok\n'
  );
  git(root, ['init']);
  git(root, ['config', 'user.email', 'specnav@example.test']);
  git(root, ['config', 'user.name', 'SpecNav Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'repair source']);

  const specReview = 'openspec/changes/change-v2/spec-review.json';
  const qualityReview = 'openspec/changes/change-v2/quality-review.json';
  fs.writeFileSync(path.join(root, specReview), '{}\n');
  fs.writeFileSync(path.join(root, qualityReview), '{}\n');
  const accepted = repairCompletionFingerprints(
    root,
    { snapshot_hash: 'a'.repeat(64) },
    { runtime_version: '2.0.0-alpha.2', runtime_root: '/runtime' },
    { digest: 'b'.repeat(64) },
    [specReview, qualityReview]
  );
  assert.equal(accepted.codeSha, git(root, ['rev-parse', 'HEAD']));
  assert.match(accepted.testSha, /^[a-f0-9]{64}$/);
  assert.match(accepted.environmentHash, /^[a-f0-9]{64}$/);

  fs.writeFileSync(path.join(root, 'tests', 'repair.test.js'), 'dirty\n');
  assert.throws(
    () => repairCompletionFingerprints(
      root,
      { snapshot_hash: 'a'.repeat(64) },
      { runtime_version: '2.0.0-alpha.2', runtime_root: '/runtime' },
      { digest: 'b'.repeat(64) },
      [specReview, qualityReview]
    ),
    /verification-production:dirty-worktree/
  );
});
