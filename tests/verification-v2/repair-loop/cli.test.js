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
  repairCompletionFingerprints,
  projectAppliedFailureState
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
    gitRevision() {
      return 'a'.repeat(40);
    },
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

function addClassifiedSecondRoot(source, deps) {
  const v2 = path.join(source.verificationRoot, 'v2');
  const runsFile = path.join(v2, 'runs.json');
  const failuresFile = path.join(v2, 'failures.json');
  const runs = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
  const failures = JSON.parse(fs.readFileSync(failuresFile, 'utf8'));
  const secondRun = {
    ...runs[0],
    id: 'run-second-root',
    case_ids: ['CASE-02']
  };
  const secondFailure = {
    ...source.failure,
    id: 'failure-second-root',
    run_id: secondRun.id,
    case_id: 'CASE-02',
    attempt_id: 'attempt-second-root'
  };
  writeJson(runsFile, [...runs, secondRun]);
  writeJson(failuresFile, [...failures, secondFailure]);
  fs.mkdirSync(path.join(
    source.verificationRoot,
    'runs',
    secondRun.id
  ), { recursive: true });
  fs.writeFileSync(path.join(
    source.verificationRoot,
    'runs',
    secondRun.id,
    'failures.jsonl'
  ), `${JSON.stringify(secondFailure)}\n`);

  const authority = createTrustedFactAuthority({
    schemaRegistry: deps.schemaRegistry,
    key: Buffer.alloc(32, 23),
    clock: () => FIXED_TIME
  });
  const effectiveFailure = {
    ...secondFailure,
    classification: 'test_defect',
    status: 'repair_required',
    next_action: 'repair_required',
    owner: 'development'
  };
  const envelope = authority.seal('classification_result', {
    ok: true,
    status: 'classified',
    packet: effectiveFailure,
    signals: [],
    blockers: []
  }, {
    failure_id: secondFailure.id,
    change_id: secondFailure.change_id,
    run_id: secondFailure.run_id,
    case_id: secondFailure.case_id
  });
  writeJson(path.join(
    source.verificationRoot,
    'repairs',
    secondFailure.id,
    'classification-envelope.json'
  ), envelope);
  return {
    authority,
    envelope,
    effectiveFailure,
    failure: secondFailure,
    run: secondRun
  };
}

function addPassedRetry(source) {
  const attemptsFile = path.join(
    source.verificationRoot,
    'v2',
    'attempts.json'
  );
  const attempts = JSON.parse(fs.readFileSync(attemptsFile, 'utf8'));
  const retry = {
    ...attempts[0],
    id: 'attempt-retry-root',
    kind: 'retry',
    sequence: 2,
    parent_attempt_id: attempts[0].id,
    status: 'passed',
    started_at: '2026-08-06T09:00:01.000Z',
    completed_at: '2026-08-06T09:00:02.000Z',
    exit_status: 0
  };
  writeJson(attemptsFile, [...attempts, retry]);
  const initialIntegrity = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'runs',
    retry.run_id,
    'attempts',
    attempts[0].id,
    'integrity.json'
  ), 'utf8'));
  writeJson(path.join(
    source.verificationRoot,
    'runs',
    retry.run_id,
    'attempts',
    retry.id,
    'integrity.json'
  ), initialIntegrity);
  return retry;
}

function makeSecondRootClosureReady(source, second) {
  const attemptsFile = path.join(
    source.verificationRoot,
    'v2',
    'attempts.json'
  );
  const attempts = JSON.parse(fs.readFileSync(attemptsFile, 'utf8'));
  const initial = {
    ...source.attempt,
    id: second.failure.attempt_id,
    run_id: second.run.id,
    case_id: second.failure.case_id
  };
  const retry = {
    ...initial,
    id: 'attempt-retry-second-root',
    kind: 'retry',
    sequence: 2,
    parent_attempt_id: initial.id,
    status: 'passed',
    started_at: '2026-08-06T09:00:01.000Z',
    completed_at: '2026-08-06T09:00:02.000Z',
    exit_status: 0
  };
  writeJson(attemptsFile, [...attempts, initial, retry]);
  const integrity = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'runs',
    source.failure.run_id,
    'attempts',
    source.failure.attempt_id,
    'integrity.json'
  ), 'utf8'));
  for (const attempt of [initial, retry]) {
    writeJson(path.join(
      source.verificationRoot,
      'runs',
      attempt.run_id,
      'attempts',
      attempt.id,
      'integrity.json'
    ), integrity);
  }

  const effectiveFailure = {
    ...second.failure,
    classification: 'environment_defect',
    status: 'retry_allowed',
    next_action: 'retry_allowed',
    owner: 'verification'
  };
  const envelope = second.authority.seal('classification_result', {
    ok: true,
    status: 'classified',
    packet: effectiveFailure,
    signals: [],
    blockers: []
  }, {
    failure_id: second.failure.id,
    change_id: second.failure.change_id,
    run_id: second.failure.run_id,
    case_id: second.failure.case_id
  });
  writeJson(path.join(
    source.verificationRoot,
    'repairs',
    second.failure.id,
    'classification-envelope.json'
  ), envelope);
  return { effectiveFailure, envelope, retry };
}

function rerunScope(source, reasons = ['repaired-case']) {
  return {
    ok: true,
    full_rerun: false,
    required_cases: [source.failure.case_id],
    baseline_cases: [],
    repaired_cases: [source.failure.case_id],
    impacted_cases: [],
    stale_cases: [source.failure.case_id],
    cases_to_rerun: [{
      case_id: source.failure.case_id,
      reasons
    }],
    reasons_by_case: {
      [source.failure.case_id]: reasons
    },
    changed_files: [],
    unmapped_changes: [],
    domains_to_rerun: ['unit'],
    codegraph_refs: [],
    policy_refs: [],
    warnings: [],
    blockers: [],
    change: source.changeId,
    invalidated_entries: [],
    blocker_ids: []
  };
}

test('repair state projects an applied close receipt as closed', () => {
  const failureId = 'failure-cli';
  const state = {
    ok: true,
    status: 'closure_ready',
    label: 'pass_after_fix',
    history: [],
    transition_proposal: {
      action: 'close_failure'
    },
    blockers: []
  };
  const projected = projectAppliedFailureState(state, {
    ok: true,
    states: [{
      failure_id: failureId,
      logical_status: 'closed',
      transition_receipt_id: 'transition-application-cli'
    }],
    effective_failures: [{
      id: failureId,
      status: 'closed'
    }],
    open_failure_ids: [],
    blockers: []
  }, failureId);

  assert.equal(projected.ok, true);
  assert.equal(projected.status, 'closed');
  assert.equal(projected.label, 'pass_after_fix');
  assert.equal(projected.transition_proposal, null);
  assert.equal(
    projected.transition_receipt_id,
    'transition-application-cli'
  );
});

test('repair state fails closed when a closed projection remains open', () => {
  const failureId = 'failure-cli';
  const projected = projectAppliedFailureState({
    ok: true,
    status: 'closure_ready',
    blockers: []
  }, {
    ok: true,
    states: [{
      failure_id: failureId,
      logical_status: 'closed',
      transition_receipt_id: 'transition-application-cli'
    }],
    effective_failures: [{
      id: failureId,
      status: 'closed'
    }],
    open_failure_ids: [failureId],
    blockers: []
  }, failureId);

  assert.equal(projected.ok, false);
  assert.equal(projected.status, 'blocked');
  assert.deepEqual(
    projected.blockers.map((entry) => entry.id),
    ['verification-repair:closed-state-inconsistent']
  );
});

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

test('repair CLI preserves classifications for two independent root failures', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const second = addClassifiedSecondRoot(source, deps);
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));

  const state = await run(baseArgs(source, 'state'), deps);
  assert.equal(state.ok, true, JSON.stringify(state.blockers));
  assert.equal(
    state.blockers.some((entry) => (
      entry.id
        === 'verification-failure-state:classification-missing-or-invalid'
    )),
    false
  );
  const repairState = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id,
    'repair-state.json'
  ), 'utf8'));
  assert.equal(repairState.ok, true, JSON.stringify(repairState.blockers));
  assert.equal(second.envelope.bindings.failure_id, second.failure.id);
});

test('repair CLI still blocks when another root classification is missing', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const second = addClassifiedSecondRoot(source, deps);
  fs.rmSync(path.join(
    source.verificationRoot,
    'repairs',
    second.failure.id,
    'classification-envelope.json'
  ));
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));

  const state = await run(baseArgs(source, 'state'), deps);
  assert.equal(state.ok, false);
  assert.deepEqual(state.blockers.filter((entry) => (
    entry.id
      === 'verification-failure-state:classification-missing-or-invalid'
  )), [{
    id: 'verification-failure-state:classification-missing-or-invalid',
    artifact: second.failure.id,
    detail: null
  }]);
});

test('repair CLI rejects an orphan classification envelope', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));
  const legitimate = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id,
    'classification-envelope.json'
  ), 'utf8'));
  const authority = createTrustedFactAuthority({
    schemaRegistry: deps.schemaRegistry,
    key: Buffer.alloc(32, 23),
    clock: () => FIXED_TIME
  });
  writeJson(path.join(
    source.verificationRoot,
    'repairs',
    'failure-orphan',
    'classification-envelope.json'
  ), authority.seal(
    'classification_result',
    {
      ...legitimate.payload,
      packet: {
        ...legitimate.payload.packet,
        id: 'failure-orphan'
      }
    },
    {
      ...legitimate.bindings,
      failure_id: 'failure-orphan'
    }
  ));

  const state = await run(baseArgs(source, 'state'), deps);
  assert.equal(state.ok, false);
  assert.equal(
    state.blockers.some((entry) => (
      entry.id === 'verification-failure-state:classification-orphaned'
    )),
    true,
    JSON.stringify(state.blockers)
  );
});

test('repair CLI rejects non-directory entries in classification inventory', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));
  fs.writeFileSync(path.join(
    source.verificationRoot,
    'repairs',
    'unmanaged.json'
  ), '{}\n');

  const state = await run(baseArgs(source, 'state'), deps);
  assert.equal(state.ok, false);
  assert.deepEqual(state.blockers, [{
    id: 'verification-repair:classification-inventory-invalid',
    artifact: 'repairs/unmanaged.json',
    detail: 'file'
  }]);
});

test('transition apply retains every independent root in global failure state', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const second = addClassifiedSecondRoot(source, deps);
  const rootCause = JSON.parse(fs.readFileSync(
    source.rootCauseFile,
    'utf8'
  ));
  writeJson(source.rootCauseFile, {
    ...rootCause,
    classification: 'environment_defect',
    summary: 'The execution environment produced a transient failure.',
    root_cause: 'A diagnostic retry is required without source changes.'
  });
  addPassedRetry(source);
  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));

  const firstEnvelope = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id,
    'classification-envelope.json'
  ), 'utf8'));
  assert.equal(firstEnvelope.payload.packet.status, 'retry_allowed');
  const state = await run(baseArgs(source, 'state'), deps);
  assert.equal(state.ok, true, JSON.stringify(state.blockers));
  assert.equal(state.status, 'closure_ready');
  assert.equal(state.transition_proposal.action, 'close_failure');
  const applied = await run([
    ...baseArgs(source, 'transition-apply'),
    '--proposal-id',
    state.transition_proposal.id,
    '--idempotency-key',
    'close-first-root'
  ], deps);
  assert.equal(applied.ok, true, JSON.stringify(applied.blockers));
  assert.deepEqual(applied.open_failure_ids, [second.failure.id]);
  const reduced = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'failure-state.json'
  ), 'utf8'));
  assert.equal(reduced.ok, true, JSON.stringify(reduced.blockers));
  assert.equal(
    reduced.states.find((entry) => (
      entry.failure_id === source.failure.id
    )).logical_status,
    'closed'
  );
  assert.equal(
    reduced.states.find((entry) => (
      entry.failure_id === second.failure.id
    )).logical_status,
    second.effectiveFailure.status
  );
});

test('transition apply scopes historical receipts to the selected root', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const second = addClassifiedSecondRoot(source, deps);
  const rootCause = JSON.parse(fs.readFileSync(
    source.rootCauseFile,
    'utf8'
  ));
  writeJson(source.rootCauseFile, {
    ...rootCause,
    classification: 'environment_defect',
    summary: 'The execution environment produced a transient failure.',
    root_cause: 'A diagnostic retry is required without source changes.'
  });
  addPassedRetry(source);
  makeSecondRootClosureReady(source, second);

  const classified = await run([
    ...baseArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], deps);
  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));

  const firstState = await run(baseArgs(source, 'state'), deps);
  assert.equal(firstState.status, 'closure_ready');
  const firstApplied = await run([
    ...baseArgs(source, 'transition-apply'),
    '--proposal-id',
    firstState.transition_proposal.id,
    '--idempotency-key',
    'close-first-root-before-second'
  ], deps);
  assert.equal(firstApplied.ok, true, JSON.stringify(firstApplied.blockers));

  const secondBaseArgs = [
    '--project',
    source.projectRoot,
    '--change',
    source.changeId,
    '--reviewer-id',
    'reviewer-1',
    '--failure-id',
    second.failure.id
  ];
  const secondState = await run(['state', ...secondBaseArgs], deps);
  assert.equal(secondState.ok, true, JSON.stringify(secondState.blockers));
  assert.equal(secondState.status, 'closure_ready');
  const secondApplied = await run([
    'transition-apply',
    ...secondBaseArgs,
    '--proposal-id',
    secondState.transition_proposal.id,
    '--idempotency-key',
    'close-second-root-after-first'
  ], deps);
  assert.equal(secondApplied.ok, true, JSON.stringify(secondApplied.blockers));
  assert.deepEqual(secondApplied.open_failure_ids, []);

  const receiptEnvelopes = fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'transition-receipts.jsonl'
  ), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(
    receiptEnvelopes.map((envelope) => envelope.bindings.log_sequence),
    [1, 2]
  );
  assert.equal(
    receiptEnvelopes[1].bindings.previous_envelope_digest,
    sha256(canonicalJson(receiptEnvelopes[0]))
  );

  const reduced = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'failure-state.json'
  ), 'utf8'));
  assert.equal(reduced.ok, true, JSON.stringify(reduced.blockers));
  assert.deepEqual(
    reduced.states.map((entry) => [
      entry.failure_id,
      entry.logical_status
    ]).sort(([left], [right]) => left.localeCompare(right)),
    [
      [source.failure.id, 'closed'],
      [second.failure.id, 'closed']
    ].sort(([left], [right]) => left.localeCompare(right))
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

test('repair CLI preserves invalid lineage and creates an approved recovery fact', async () => {
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
  const requestedFile = path.join(
    repairRoot,
    'repair-link-requested-envelope.json'
  );
  const requestedEnvelope = JSON.parse(fs.readFileSync(
    requestedFile,
    'utf8'
  ));
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
  const historicalAfter = {
    ...replacedIdentity,
    test_sha: 'e'.repeat(64)
  };
  const completedEnvelope = authority.seal('repair_link', {
    ...startedEnvelope.payload,
    status: 'completed',
    completed_at: FIXED_TIME,
    after_identity: historicalAfter,
    review_evidence_ids: [
      'quality-review-evidence-cli',
      'spec-review-evidence-cli'
    ]
  }, envelopeBindings);
  const startedFile = path.join(
    repairRoot,
    'repair-link-started-envelope.json'
  );
  const completedFile = path.join(
    repairRoot,
    'repair-link-completed-envelope.json'
  );
  writeJson(startedFile, startedEnvelope);
  writeJson(completedFile, completedEnvelope);
  const startedBytes = fs.readFileSync(startedFile);
  const completedBytes = fs.readFileSync(completedFile);

  const currentIdentity = {
    ...requestedEnvelope.payload.before_identity,
    code_sha: 'c'.repeat(40),
    test_sha: 'd'.repeat(64),
    environment_hash: 'b'.repeat(64)
  };
  const specReview = writeRepairReview({
    source,
    taskId: requested.development_task_id,
    link: startedEnvelope.payload,
    afterIdentity: historicalAfter,
    kind: 'spec-review',
    reviewerId: 'spec-reviewer'
  });
  const qualityReview = writeRepairReview({
    source,
    taskId: requested.development_task_id,
    link: startedEnvelope.payload,
    afterIdentity: historicalAfter,
    kind: 'quality-review',
    reviewerId: 'quality-reviewer'
  });
  const recoveryReview = path.join(
    source.projectRoot,
    'openspec',
    'changes',
    source.changeId,
    'repair-lineage-recovery-review.json'
  );
  writeJson(recoveryReview, {
    schema: 'specnav.verification.repair-lineage-recovery-review.v1',
    id: 'repair-lineage-recovery-review-cli',
    failure_id: source.failure.id,
    change_id: source.failure.change_id,
    classification: 'test_defect',
    decision: 'approved',
    reviewer: {
      id: 'reviewer-1',
      kind: 'human'
    },
    reviewed_at: FIXED_TIME,
    reason: 'The started and completed envelopes replaced before_identity.',
    requested_envelope_digest: sha256(canonicalJson(requestedEnvelope)),
    invalid_envelopes: [
      {
        artifact: 'repair-link-completed-envelope.json',
        envelope_digest: sha256(canonicalJson(completedEnvelope)),
        drift_fields: ['before_identity']
      },
      {
        artifact: 'repair-link-started-envelope.json',
        envelope_digest: sha256(canonicalJson(startedEnvelope)),
        drift_fields: ['before_identity']
      }
    ],
    repair_revision_range: {
      before_revision: '1'.repeat(40),
      after_revision: '2'.repeat(40)
    },
    allowed_identity_drift: ['environment_hash'],
    expected_current_identity_digest: sha256(canonicalJson(currentIdentity))
  });
  const recovered = await run([
    ...baseArgs(source, 'repair-recover'),
    '--recovery-review',
    path.relative(source.projectRoot, recoveryReview),
    '--spec-review',
    path.relative(source.projectRoot, specReview),
    '--quality-review',
    path.relative(source.projectRoot, qualityReview)
  ], {
    ...deps,
    fingerprints() {
      return {
        codeSha: currentIdentity.code_sha,
        testSha: currentIdentity.test_sha,
        environmentHash: currentIdentity.environment_hash
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
  });

  assert.equal(recovered.ok, true, JSON.stringify(recovered.blockers));
  assert.equal(recovered.status, 'repair_recovered');
  assert.equal(recovered.fallback_used, false);
  assert.deepEqual(fs.readFileSync(startedFile), startedBytes);
  assert.deepEqual(fs.readFileSync(completedFile), completedBytes);
  assert.equal(fs.existsSync(path.join(
    repairRoot,
    'repair-lineage-recoveries.jsonl'
  )), true);
  const recoveryHistory = fs.readFileSync(path.join(
    repairRoot,
    'repair-lineage-recoveries.jsonl'
  ), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(recoveryHistory.length, 1);
  assert.equal(recoveryHistory[0].kind, 'repair_recovery');
  assert.equal(fs.existsSync(path.join(
    repairRoot,
    'repair-link-recovered.json'
  )), true);
});

test('rerun planning migrates the legacy envelope and appends refreshed authority', async () => {
  const source = projectFixture();
  const deps = dependencies();
  const authority = createTrustedFactAuthority({
    schemaRegistry: deps.schemaRegistry,
    key: Buffer.alloc(32, 23),
    clock: () => FIXED_TIME
  });
  const bindings = {
    failure_id: source.failure.id,
    change_id: source.failure.change_id,
    run_id: source.failure.run_id,
    case_id: source.failure.case_id
  };
  const repairRoot = path.join(
    source.verificationRoot,
    'repairs',
    source.failure.id
  );
  const legacyFile = path.join(repairRoot, 'rerun-plan-envelope.json');
  const legacy = authority.seal(
    'rerun_plan',
    rerunScope(source, ['legacy-reason']),
    bindings
  );
  writeJson(legacyFile, legacy);
  const legacyBytes = fs.readFileSync(legacyFile);
  const current = rerunScope(source, ['current-reason', 'repaired-case']);
  const planned = await run(
    baseArgs(source, 'rerun-plan'),
    {
      ...deps,
      computeRerunScope() {
        return current;
      }
    }
  );
  assert.equal(planned.ok, true, JSON.stringify(planned.blockers));
  assert.equal(planned.replayed, false);
  assert.deepEqual(fs.readFileSync(legacyFile), legacyBytes);

  const historyFile = path.join(repairRoot, 'rerun-plans.jsonl');
  const history = fs.readFileSync(historyFile, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry) => entry.payload), [
    legacy.payload,
    current
  ]);
  assert.equal(history[0].bindings.log_sequence, 1);
  assert.equal(history[1].bindings.log_sequence, 2);
  assert.equal(
    history[1].bindings.previous_envelope_digest,
    sha256(canonicalJson(history[0]))
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(
    repairRoot,
    'rerun-plan.json'
  ), 'utf8')), current);

  const replayed = await run(
    baseArgs(source, 'rerun-plan'),
    {
      ...deps,
      computeRerunScope() {
        return current;
      }
    }
  );
  assert.equal(replayed.ok, true, JSON.stringify(replayed.blockers));
  assert.equal(replayed.replayed, true);
  assert.equal(
    fs.readFileSync(historyFile, 'utf8').trim().split(/\r?\n/).length,
    2
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
  assert.equal(
    accepted.codeSha,
    verificationKernel.codeInventorySha(
      git(root, ['ls-tree', '-r', 'HEAD'])
    )
  );
  assert.match(accepted.testSha, /^[a-f0-9]{64}$/);
  assert.match(accepted.environmentHash, /^[a-f0-9]{64}$/);

  git(root, ['add', specReview, qualityReview]);
  git(root, ['commit', '-m', 'record review receipts']);
  fs.writeFileSync(path.join(root, specReview), '{"approved":true}\n');
  const updated = repairCompletionFingerprints(
    root,
    { snapshot_hash: 'a'.repeat(64) },
    { runtime_version: '2.0.0-alpha.2', runtime_root: '/runtime' },
    { digest: 'b'.repeat(64) },
    [specReview, qualityReview]
  );
  assert.match(updated.codeSha, /^[a-f0-9]{40}$/);

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
