'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const kernel = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel'
));
const {
  createCasePlanner,
  createCaseSnapshotWriter
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/cases'
));
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');
const {
  exactProtocol
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/pipeline/production-runner'
));
const {
  freshnessProjection
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/pipeline/artifact-pipeline'
));
const {
  serializeMidscenePrompt
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/execution/midscene-prompt'
));
const {
  serializePlaywrightScenario
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/execution/playwright-scenario'
));
const {
  createTrustedFactAuthority
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/repair/trusted-fact-authority'
));
const {
  createAuthorityLog
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/repair/authority-log'
));
const {
  createTransitionApplier
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/repair/transition-applier'
));

function clock() {
  let tick = 0;
  return () => {
    const value = new Date(Date.UTC(2026, 7, 2, 20, 0, 0, tick));
    tick += 1;
    return value.toISOString();
  };
}

function fixture(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-production-'
  ));
  const changeId = 'change-production';
  const changeRoot = path.join(
    projectRoot,
    'openspec',
    'changes',
    changeId
  );
  const verificationRoot = path.join(changeRoot, 'verify');
  fs.mkdirSync(path.join(verificationRoot, 'v2'), { recursive: true });
  const runnerFile = path.join(projectRoot, 'runner.js');
  fs.writeFileSync(runnerFile, options.runnerSource || [
    "'use strict';",
    "const fs = require('node:fs');",
    "const ids = process.env.SPECNAV_VERIFICATION_ASSERTION_IDS.split(',');",
    'const rows = ids.map((assertionId) => JSON.stringify({',
    '  assertion_id: assertionId,',
    "  method: 'equal',",
    '  expected: true,',
    '  actual: true,',
    "  status: 'passed'",
    '}));',
    'fs.writeFileSync(',
    '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
    "  `${rows.join('\\n')}\\n`,",
    "  { flag: 'wx' }",
    ');',
    "process.stdout.write('fixture passed\\n');",
    ''
  ].join('\n'));
  const requirements = [{
    id: 'REQ-1',
    statement: 'The production runner persists trusted verification facts.'
  }];
  const acceptance = [{
    id: 'AC-1',
    statement: 'Approved command execution produces six-domain evidence.'
  }];
  const assertion = options.assertion || {
    id: 'ASSERT-1',
    statement: 'The command fixture passes.',
    expected: true,
    oracle: {
      type: 'structured_comparison',
      human_signoff_allowed: false
    },
    evidence_kinds: [
      'assertion_result',
      'command_output',
      'structured_comparison'
    ]
  };
  const caseRunner = options.runner || {
    kind: 'command',
    timeout_ms: 5000,
    entrypoint: process.execPath,
    args: ['runner.js'],
    cwd: '.',
    env_keys: [...kernel.PROTOCOL_ENV],
    requires_midscene: false
  };
  const testCase = {
    schema: 'specnav.verification.test-case.v1',
    id: 'CASE-1',
    change_id: changeId,
    requirement_ids: ['REQ-1'],
    acceptance_ids: ['AC-1'],
    title: 'Production runner fixture',
    goal: 'Exercise the complete command evidence path.',
    actor: 'verification-reviewer',
    priority: 'P0',
    preconditions: [],
    steps: [{
      id: 'STEP-1',
      action: 'Run the fixture.',
      expected: 'The structured assertion passes.',
      assertion_ids: [assertion.id]
    }],
    assertions: [assertion],
    domains: Object.fromEntries(kernel.SIX_DOMAINS.map((domain) => [
      domain,
      {
        mode: 'required',
        assertion_ids: [assertion.id],
        runner: caseRunner.kind
      }
    ])),
    runner: caseRunner,
    evidence_policy: {
      allowed_kinds: assertion.evidence_kinds,
      required_kinds: assertion.evidence_kinds,
      retain_on_failure: true,
      content_addressed: true
    },
    status: 'ready',
    created_at: '2026-08-02T19:59:00Z'
  };
  const schemaRegistry = readySchemaRegistry();
  const plan = createCasePlanner({ schemaRegistry }).plan({
    changeId,
    requirements,
    acceptance,
    cases: [testCase]
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.blockers));
  const snapshotResult = createCaseSnapshotWriter({
    schemaRegistry
  }).create({
    plan,
    createdAt: '2026-08-02T19:59:00Z',
    createdBy: { id: 'reviewer-1', kind: 'human' }
  });
  assert.equal(
    snapshotResult.ok,
    true,
    JSON.stringify(snapshotResult.blockers)
  );
  const snapshot = snapshotResult.snapshot;
  const approval = {
    schema: 'specnav.verification.case-approval.v1',
    id: 'approval-production',
    change_id: changeId,
    snapshot_id: snapshot.id,
    snapshot_hash: snapshot.snapshot_hash,
    decision: 'approved',
    reviewer: { id: 'reviewer-1', kind: 'human' },
    decided_at: '2026-08-02T19:59:30Z'
  };
  const runtimeStatus = JSON.parse(fs.readFileSync(path.join(
    ROOT,
    'tests/verification-v2/contracts/fixtures/positive/runtime-status.json'
  ), 'utf8'));
  const trustedFactAuthority = createTrustedFactAuthority({
    schemaRegistry,
    key: Buffer.alloc(32, 29),
    clock: clock()
  });
  return {
    projectRoot,
    changeRoot,
    verificationRoot,
    requirements,
    acceptance,
    testCase,
    snapshot,
    approval,
    runtimeStatus,
    schemaRegistry,
    trustedFactAuthority
  };
}

function runner(source, overrides = {}) {
  const codeSha = overrides.codeSha || '1'.repeat(40);
  const testSha = overrides.testSha || '2'.repeat(64);
  const environmentHash = overrides.environmentHash || '3'.repeat(64);
  return kernel.createProductionVerificationRunner({
    kernel,
    schemaRegistry: source.schemaRegistry,
    projectRoot: source.projectRoot,
    changeRoot: source.changeRoot,
    verificationRoot: source.verificationRoot,
    runtimeStatus: source.runtimeStatus,
    snapshot: source.snapshot,
    approval: source.approval,
    requirements: source.requirements,
    acceptance: source.acceptance,
    reviewerId: 'reviewer-1',
    codeSha,
    testSha,
    environmentHash,
    repairIdentityResolver: () => ({
      ok: true,
      identity: {
        case_snapshot_hash: source.snapshot.snapshot_hash,
        code_sha: codeSha,
        test_sha: testSha,
        environment_hash: environmentHash,
        runtime_version: source.runtimeStatus.runtime_version,
        kernel_version: kernel.metadata.version
      },
      blockers: []
    }),
    clock: clock(),
    secrets: [],
    ...overrides
  });
}

function currentFingerprints(source, overrides = {}) {
  return {
    case_snapshot_hash: source.snapshot.snapshot_hash,
    code_sha: '1'.repeat(40),
    test_sha: '2'.repeat(64),
    environment_hash: '3'.repeat(64),
    runtime_version: source.runtimeStatus.runtime_version,
    kernel_version: kernel.metadata.version,
    ...overrides
  };
}

test('approval failure blocks before any run directory or process execution', async () => {
  const source = fixture();
  const subject = runner(source, { approval: null });

  const result = await subject.executeCase(source.testCase.id);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-cases:approval-missing'
    )),
    true
  );
  assert.equal(
    fs.existsSync(path.join(source.verificationRoot, 'runs')),
    false
  );
});

test('approved command persists run, attempt, evidence, integrity and six-domain readings', async () => {
  const source = fixture();

  const result = await runner(source).executeCase(source.testCase.id);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'passed');
  assert.equal(result.evidence.length, 3);
  assert.equal(result.readings.length, 6);
  assert.equal(result.integrity.ok, true);
  assert.equal(
    fs.existsSync(path.join(
      source.verificationRoot,
      'runs',
      result.run.id,
      'run-states.jsonl'
    )),
    true
  );
  assert.equal(
    fs.existsSync(path.join(
      source.verificationRoot,
      'evidence',
      'raw.jsonl'
    )),
    true
  );
  const index = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'evidence',
    'index.json'
  ), 'utf8'));
  assert.equal(index.record_count, 3);
});

test('assertion protocol rejects missing duplicate extra and forged results', () => {
  const source = fixture();
  const approved = source.testCase;
  const valid = {
    assertion_id: 'ASSERT-1',
    method: 'equal',
    expected: true,
    actual: true,
    status: 'passed'
  };
  const cases = [
    [[], 'verification-production:assertion-result-missing'],
    [[valid, valid], 'verification-production:assertion-result-ambiguous'],
    [[valid, { ...valid, assertion_id: 'ASSERT-X' }],
      'verification-production:assertion-result-unapproved'],
    [[{ ...valid, expected: false }],
      'verification-production:assertion-result-invalid'],
    [[{ ...valid, actual: false }],
      'verification-production:assertion-result-invalid']
  ];
  for (const [values, blockerId] of cases) {
    const result = exactProtocol(approved, values);
    assert.equal(result.ok, false);
    assert.equal(
      result.blockers.some((entry) => entry.id === blockerId),
      true,
      blockerId
    );
  }
});

test('failed command retains evidence and freezes an open failure packet', async () => {
  const source = fixture({
    runnerSource: [
      "'use strict';",
      "const fs = require('node:fs');",
      'fs.writeFileSync(',
      '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
      "  `${JSON.stringify({",
      "    assertion_id: 'ASSERT-1',",
      "    method: 'equal',",
      '    expected: true,',
      '    actual: false,',
      "    status: 'failed'",
      "  })}\\n`,",
      "  { flag: 'wx' }",
      ');',
      "process.stderr.write('fixture failed\\n');",
      'process.exit(1);',
      ''
    ].join('\n')
  });

  const result = await runner(source).executeCase(source.testCase.id);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_packet?.status, 'open');
  assert.equal(result.failure_packet?.classification, null);
  assert.equal(result.repair_handoff?.next_action, 'classify_failure');
  assert.equal(result.evidence.some((entry) => entry.result === 'fail'), true);
  const failures = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'failures.json'
  ), 'utf8'));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, result.failure_packet.id);
  assert.equal(
    fs.existsSync(path.join(
      source.verificationRoot,
      'runs',
      result.run.id,
      'failures.jsonl'
    )),
    true
  );
});

test('retry remains in the same run and rejects changed immutable fingerprints', async () => {
  const source = fixture();
  const first = await runner(source).executeCase(source.testCase.id);
  assert.equal(first.ok, true, JSON.stringify(first.blockers));

  const retry = await runner(source).executeCase(source.testCase.id, {
    kind: 'retry',
    parentAttemptId: first.attempt.id
  });

  assert.equal(retry.ok, true, JSON.stringify(retry.blockers));
  assert.equal(retry.run.id, first.run.id);
  assert.equal(retry.attempt.kind, 'retry');
  assert.equal(retry.attempt.parent_attempt_id, first.attempt.id);
  assert.equal(retry.attempt.sequence, first.attempt.sequence + 1);

  const changed = await runner(source, {
    codeSha: '9'.repeat(40)
  }).executeCase(source.testCase.id, {
    kind: 'retry',
    parentAttemptId: retry.attempt.id
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.status, 'blocked');
  assert.equal(
    changed.blockers[0].id,
    'verification-production:retry-identity-mismatch'
  );
});

test('retry does not require a completed repair identity', async () => {
  const source = fixture();
  const first = await runner(source, {
    repairIdentityResolver: null
  }).executeCase(source.testCase.id);
  assert.equal(first.ok, true, JSON.stringify(first.blockers));

  const retry = await runner(source, {
    repairIdentityResolver: null
  }).executeCase(source.testCase.id, {
    kind: 'retry',
    parentAttemptId: first.attempt.id
  });

  assert.equal(retry.ok, true, JSON.stringify(retry.blockers));
  assert.equal(retry.run.id, first.run.id);
  assert.equal(retry.attempt.kind, 'retry');
});

test('retry preserves immutable attempt integrity and finalizes the full evidence history', async () => {
  const source = fixture();
  const first = await runner(source).executeCase(source.testCase.id);
  const retry = await runner(source).executeCase(source.testCase.id, {
    kind: 'retry',
    parentAttemptId: first.attempt.id
  });

  assert.equal(first.ok, true, JSON.stringify(first.blockers));
  assert.equal(retry.ok, true, JSON.stringify(retry.blockers));
  const firstIntegrityFile = path.join(
    source.verificationRoot,
    'runs',
    first.run.id,
    'attempts',
    first.attempt.id,
    'integrity.json'
  );
  const retryIntegrityFile = path.join(
    source.verificationRoot,
    'runs',
    retry.run.id,
    'attempts',
    retry.attempt.id,
    'integrity.json'
  );
  const firstIntegrity = JSON.parse(fs.readFileSync(firstIntegrityFile, 'utf8'));
  const retryIntegrity = JSON.parse(fs.readFileSync(retryIntegrityFile, 'utf8'));
  const runIntegrity = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'runs',
    retry.run.id,
    'integrity.json'
  ), 'utf8'));
  assert.equal(firstIntegrity.facts.summary.evidence_count, 3);
  assert.equal(retryIntegrity.facts.summary.evidence_count, 3);
  assert.equal(runIntegrity.facts.summary.evidence_count, 6);

  const finalized = kernel.createVerificationArtifactPipeline({
    kernel,
    schemaRegistry: source.schemaRegistry,
    changeRoot: source.changeRoot,
    verificationRoot: source.verificationRoot,
    snapshot: source.snapshot,
    approval: source.approval,
    currentFingerprints: currentFingerprints(source),
    trustedFactAuthority: source.trustedFactAuthority,
    clock: clock()
  }).build();
  assert.equal(finalized.ok, true, JSON.stringify(finalized.blockers));
  const finalIntegrity = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'integrity.json'
  ), 'utf8'));
  assert.equal(finalIntegrity.facts.summary.evidence_count, 6);
});

test('retest and regression create new runs with immutable cross-run lineage', async () => {
  const source = fixture({
    runnerSource: [
      "'use strict';",
      "const fs = require('node:fs');",
      'fs.writeFileSync(',
      '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
      "  `${JSON.stringify({",
      "    assertion_id: 'ASSERT-1',",
      "    method: 'equal',",
      '    expected: true,',
      '    actual: false,',
      "    status: 'failed'",
      "  })}\\n`,",
      "  { flag: 'wx' }",
      ');',
      'process.exit(1);',
      ''
    ].join('\n')
  });
  const first = await runner(source).executeCase(source.testCase.id);
  assert.equal(first.status, 'failed');
  assert.equal(first.failure_packet?.status, 'open');
  fs.writeFileSync(path.join(source.projectRoot, 'runner.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const ids = process.env.SPECNAV_VERIFICATION_ASSERTION_IDS.split(',');",
    'const rows = ids.map((assertionId) => JSON.stringify({',
    '  assertion_id: assertionId,',
    "  method: 'equal',",
    '  expected: true,',
    '  actual: true,',
    "  status: 'passed'",
    '}));',
    'fs.writeFileSync(',
    '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
    "  `${rows.join('\\n')}\\n`,",
    "  { flag: 'wx' }",
    ');',
    ''
  ].join('\n'));

  const retest = await runner(source, {
    codeSha: '3'.repeat(40)
  }).executeCase(source.testCase.id, {
    kind: 'retest',
    parentAttemptId: first.attempt.id,
    failureId: first.failure_packet.id
  });

  assert.equal(retest.ok, true, JSON.stringify(retest.blockers));
  assert.notEqual(retest.run.id, first.run.id);
  assert.equal(retest.run.kind, 'retest');
  assert.equal(retest.run.origin_run_id, first.run.id);
  assert.equal(retest.run.parent_run_id, first.run.id);
  assert.equal(retest.run.parent_attempt_id, first.attempt.id);
  assert.equal(retest.run.failure_id, first.failure_packet.id);
  assert.equal(retest.attempt.kind, 'retest');
  assert.equal(retest.attempt.sequence, first.attempt.sequence + 1);

  const regression = await runner(source, {
    codeSha: '3'.repeat(40)
  }).executeCase(source.testCase.id, {
    kind: 'regression',
    parentAttemptId: retest.attempt.id,
    failureId: first.failure_packet.id
  });

  assert.equal(regression.ok, true, JSON.stringify(regression.blockers));
  assert.notEqual(regression.run.id, retest.run.id);
  assert.equal(regression.run.kind, 'regression');
  assert.equal(regression.run.origin_run_id, first.run.id);
  assert.equal(regression.run.parent_run_id, retest.run.id);
  assert.equal(regression.run.parent_attempt_id, retest.attempt.id);
  assert.equal(regression.run.failure_id, first.failure_packet.id);
  assert.equal(regression.attempt.kind, 'regression');
  assert.equal(regression.attempt.sequence, retest.attempt.sequence + 1);

  const failures = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'failures.json'
  ), 'utf8'));
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [first.failure_packet.id]
  );
  for (const followup of [retest, regression]) {
    assert.equal(
      fs.existsSync(path.join(
        source.verificationRoot,
        'runs',
        followup.run.id,
        'failures.jsonl'
      )),
      false
    );
  }
});

test('follow-up execution blocks before creating artifacts when repair identity differs', async () => {
  const source = fixture({
    runnerSource: [
      "'use strict';",
      "const fs = require('node:fs');",
      'fs.writeFileSync(',
      '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
      "  `${JSON.stringify({",
      "    assertion_id: 'ASSERT-1',",
      "    method: 'equal',",
      '    expected: true,',
      '    actual: false,',
      "    status: 'failed'",
      "  })}\\n`,",
      "  { flag: 'wx' }",
      ');',
      'process.exit(1);',
      ''
    ].join('\n')
  });
  const initial = await runner(source).executeCase(source.testCase.id);
  const runRoot = path.join(source.verificationRoot, 'runs');
  const before = fs.readdirSync(runRoot).sort();
  const result = await runner(source, {
    codeSha: '3'.repeat(40),
    repairIdentityResolver: () => ({
      ok: true,
      identity: currentFingerprints(source, {
        code_sha: '4'.repeat(40)
      }),
      blockers: []
    })
  }).executeCase(source.testCase.id, {
    kind: 'retest',
    parentAttemptId: initial.attempt.id,
    failureId: initial.failure_packet.id
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((entry) => entry.id),
    ['verification-production:followup-repair-identity-mismatch']
  );
  assert.deepEqual(fs.readdirSync(runRoot).sort(), before);
});

test('failed retest and regression attempts retain subordinate failure packets', async () => {
  const source = fixture({
    runnerSource: [
      "'use strict';",
      "const fs = require('node:fs');",
      'fs.writeFileSync(',
      '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
      "  `${JSON.stringify({",
      "    assertion_id: 'ASSERT-1',",
      "    method: 'equal',",
      '    expected: true,',
      '    actual: false,',
      "    status: 'failed'",
      "  })}\\n`,",
      "  { flag: 'wx' }",
      ');',
      'process.exit(1);',
      ''
    ].join('\n')
  });
  const initial = await runner(source).executeCase(source.testCase.id);
  assert.equal(initial.failure_packet?.status, 'open');

  const retest = await runner(source, {
    codeSha: '3'.repeat(40)
  }).executeCase(source.testCase.id, {
    kind: 'retest',
    parentAttemptId: initial.attempt.id,
    failureId: initial.failure_packet.id
  });
  assert.equal(retest.status, 'failed');
  assert.equal(retest.failure_packet?.attempt_id, retest.attempt.id);
  assert.equal(retest.repair_handoff, null);

  const regression = await runner(source, {
    codeSha: '3'.repeat(40)
  }).executeCase(source.testCase.id, {
    kind: 'regression',
    parentAttemptId: retest.attempt.id,
    failureId: initial.failure_packet.id
  });
  assert.equal(regression.status, 'failed');
  assert.equal(regression.failure_packet?.attempt_id, regression.attempt.id);
  assert.equal(regression.repair_handoff, null);

  const failures = JSON.parse(fs.readFileSync(path.join(
    source.verificationRoot,
    'v2',
    'failures.json'
  ), 'utf8'));
  assert.deepEqual(
    failures.map((failure) => failure.attempt_id).sort(),
    [
      initial.attempt.id,
      regression.attempt.id,
      retest.attempt.id
    ].sort()
  );
  for (const followup of [retest, regression]) {
    const rows = fs.readFileSync(path.join(
      source.verificationRoot,
      'runs',
      followup.run.id,
      'failures.jsonl'
    ), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, followup.failure_packet.id);
  }
});

test('finalize derives release and archive gates from raw failures and signed closure logs', async () => {
  const source = fixture({
    runnerSource: [
      "'use strict';",
      "const fs = require('node:fs');",
      'fs.writeFileSync(',
      '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
      "  `${JSON.stringify({",
      "    assertion_id: 'ASSERT-1',",
      "    method: 'equal',",
      '    expected: true,',
      '    actual: false,',
      "    status: 'failed'",
      "  })}\\n`,",
      "  { flag: 'wx' }",
      ');',
      'process.exit(1);',
      ''
    ].join('\n')
  });
  const initial = await runner(source).executeCase(source.testCase.id);
  assert.equal(initial.status, 'failed');
  assert.equal(initial.failure_packet?.status, 'open');

  fs.writeFileSync(path.join(source.projectRoot, 'runner.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const ids = process.env.SPECNAV_VERIFICATION_ASSERTION_IDS.split(',');",
    'const rows = ids.map((assertionId) => JSON.stringify({',
    '  assertion_id: assertionId,',
    "  method: 'equal',",
    '  expected: true,',
    '  actual: true,',
    "  status: 'passed'",
    '}));',
    'fs.writeFileSync(',
    '  process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE,',
    "  `${rows.join('\\n')}\\n`,",
    "  { flag: 'wx' }",
    ');',
    ''
  ].join('\n'));
  const retest = await runner(source, {
    codeSha: '4'.repeat(40)
  }).executeCase(source.testCase.id, {
    kind: 'retest',
    parentAttemptId: initial.attempt.id,
    failureId: initial.failure_packet.id
  });
  const regression = await runner(source, {
    codeSha: '4'.repeat(40)
  }).executeCase(source.testCase.id, {
    kind: 'regression',
    parentAttemptId: retest.attempt.id,
    failureId: initial.failure_packet.id
  });
  assert.equal(retest.ok, true, JSON.stringify(retest.blockers));
  assert.equal(regression.ok, true, JSON.stringify(regression.blockers));

  const failure = initial.failure_packet;
  const classified = source.schemaRegistry.assertValid('failure-packet', {
    ...failure,
    classification: 'test_defect',
    status: 'repair_required',
    next_action: 'repair_required',
    owner: 'development'
  });
  const bindings = {
    failure_id: failure.id,
    change_id: failure.change_id,
    run_id: failure.run_id,
    case_id: failure.case_id
  };
  const classificationEnvelope = source.trustedFactAuthority.seal(
    'classification_result',
    {
      ok: true,
      status: 'classified',
      packet: classified,
      signals: [],
      blockers: []
    },
    bindings
  );
  const store = kernel.createVerificationArtifactStore({
    changeRoot: source.changeRoot,
    root: source.verificationRoot
  });
  const classificationWrite = store.publishImmutableJson(
    `repairs/${failure.id}/classification-envelope.json`,
    classificationEnvelope
  );
  assert.equal(
    classificationWrite.ok,
    true,
    JSON.stringify(classificationWrite.blockers)
  );

  const proposal = source.schemaRegistry.assertValid('transition-proposal', {
    schema: 'specnav.verification.transition-proposal.v1',
    id: 'transition-production-close',
    failure_id: failure.id,
    change_id: failure.change_id,
    action: 'close_failure',
    owner: 'core',
    from_state: 'closure_ready',
    target_state: 'closed',
    case_ids: [failure.case_id],
    attempt_ids: [retest.attempt.id, regression.attempt.id],
    reason_ids: ['required-retest-and-regression-passed'],
    proposed_at: '2026-08-02T20:10:00.000Z'
  });
  const authorityLog = createAuthorityLog({
    store,
    authority: source.trustedFactAuthority
  });
  const proposalLog = authorityLog.append(
    'v2/transition-proposals.jsonl',
    'transition_proposal',
    proposal,
    bindings
  );
  assert.equal(proposalLog.ok, true, JSON.stringify(proposalLog.blockers));
  const applied = createTransitionApplier({
    schemaRegistry: source.schemaRegistry,
    trustVerifier: source.trustedFactAuthority,
    clock: () => '2026-08-02T20:11:00.000Z'
  }).apply({
    root_failure: failure,
    effective_failure: classified,
    proposal_id: proposal.id,
    idempotency_key: 'apply-production-close',
    proposal_envelopes: proposalLog.values,
    receipt_envelopes: []
  });
  assert.equal(applied.ok, true, JSON.stringify(applied.blockers));
  const receiptLog = authorityLog.append(
    'v2/transition-receipts.jsonl',
    'transition_application',
    applied.receipt,
    bindings
  );
  assert.equal(receiptLog.ok, true, JSON.stringify(receiptLog.blockers));

  const build = () => kernel.createVerificationArtifactPipeline({
    kernel,
    schemaRegistry: source.schemaRegistry,
    changeRoot: source.changeRoot,
    verificationRoot: source.verificationRoot,
    snapshot: source.snapshot,
    approval: source.approval,
    currentFingerprints: currentFingerprints(source, {
      code_sha: '4'.repeat(40)
    }),
    trustedFactAuthority: source.trustedFactAuthority,
    clock: clock(),
    secrets: []
  }).build();
  const finalized = build();
  assert.equal(finalized.ok, true, JSON.stringify(finalized.blockers));
  assert.equal(finalized.release_gate.decision, 'pass');
  assert.equal(finalized.archive_gate.decision, 'pass');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(
      source.verificationRoot,
      'v2',
      'failure-state.json'
    ), 'utf8')).open_failure_ids,
    []
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(
      source.verificationRoot,
      'v2',
      'failures.json'
    ), 'utf8')),
    [failure]
  );

  fs.writeFileSync(path.join(
    source.verificationRoot,
    'v2',
    'transition-receipts.jsonl'
  ), '');
  const withoutClosureReceipt = build();
  assert.equal(withoutClosureReceipt.ok, false);
  assert.equal(
    withoutClosureReceipt.blockers.some((entry) => (
      entry.id === 'verification-authority-log:anchor-regressed'
    )),
    true
  );
  assert.equal(withoutClosureReceipt.release_gate.decision, 'block');
  assert.equal(withoutClosureReceipt.archive_gate.decision, 'block');
  assert.deepEqual(
    withoutClosureReceipt.gate_input.open_failure_ids,
    [failure.id]
  );
});

test('approved Playwright scenario uses the shared evidence and reading pipeline', async () => {
  const scenario = async ({ assertion }) => {
    assertion.ok('ASSERT-1', true);
  };
  const scenarioHash = crypto.createHash('sha256')
    .update(Function.prototype.toString.call(scenario))
    .digest('hex');
  const source = fixture({
    assertion: {
      id: 'ASSERT-1',
      statement: 'The browser fixture passes.',
      expected: true,
      oracle: {
        type: 'playwright_assertion',
        human_signoff_allowed: false
      },
      evidence_kinds: ['assertion_result', 'screenshot']
    },
    runner: {
      kind: 'playwright',
      timeout_ms: 5000,
      scenario_id: 'scenario-browser',
      scenario_hash: scenarioHash,
      browser_project: 'chromium',
      allowed_origins: ['http://127.0.0.1:4173'],
      requires_midscene: false
    }
  });
  source.runtimeStatus.checks.browsers = [{
    name: 'chromium',
    executable_exists: true,
    executable_allowed: true,
    probe_ok: true
  }];
  const subject = runner(source, {
    scenarioRegistry: {
      resolve() {
        return { scenario, scenario_data: null };
      }
    },
    playwrightAdapter: {
      validate() {
        return { ok: true, blockers: [] };
      },
      async execute(request) {
        fs.mkdirSync(request.artifact_root, { recursive: true });
        const screenshot = path.join(request.artifact_root, 'screenshot.png');
        fs.writeFileSync(screenshot, 'png');
        return {
          status: 'passed',
          exit_status: 0,
          signal: null,
          timed_out: false,
          canceled: false,
          spawn_error: null,
          stdout: '',
          stderr: '',
          browser: { project: 'chromium' },
          assertions: [{
            id: 'ASSERT-1',
            method: 'equal',
            expected: true,
            actual: true,
            status: 'passed'
          }],
          artifacts: [{
            kind: 'screenshot',
            path: screenshot,
            producer: 'playwright-runner',
            sha256: crypto.createHash('sha256').update('png').digest('hex'),
            size: 3
          }],
          console: [],
          network: [],
          blockers: []
        };
      }
    }
  });

  const result = await subject.executeCase(source.testCase.id);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.evidence.length, 2);
  assert.equal(result.readings.length, 6);
});

test('approved Midscene scenario uses the shared evidence and deterministic oracle pipeline', async () => {
  const prompt = 'Open the payroll summary and inspect the approved status.';
  const oracleScenario = async ({ assertion, data }) => {
    assertion.ok('ASSERT-1', data.actual);
  };
  const promptHash = serializeMidscenePrompt(prompt).hash;
  const oracleScenarioHash = serializePlaywrightScenario(oracleScenario).hash;
  const source = fixture({
    assertion: {
      id: 'ASSERT-1',
      statement: 'The Midscene-assisted browser fixture passes.',
      expected: true,
      oracle: {
        type: 'structured_comparison',
        human_signoff_allowed: false
      },
      evidence_kinds: ['structured_comparison', 'screenshot']
    },
    runner: {
      kind: 'midscene',
      timeout_ms: 5000,
      scenario_id: 'scenario-midscene-production',
      scenario_hash: 'a'.repeat(64),
      browser_project: 'chromium',
      allowed_origins: ['http://127.0.0.1:4173'],
      prompt_id: 'prompt-midscene-production',
      prompt_hash: promptHash,
      start_url: 'http://127.0.0.1:4173/payroll',
      oracle_scenario_hash: oracleScenarioHash,
      oracle_assertion_ids: ['ASSERT-1'],
      requires_midscene: true
    }
  });
  source.runtimeStatus.requires_midscene = true;
  source.runtimeStatus.checks.provider = {
    configured: true,
    model_name_present: true,
    model_family_present: true,
    credential_source: 'MIDSCENE_MODEL_API_KEY',
    base_url_present: true,
    configuration_fingerprint: '4'.repeat(64),
    secret_values_exposed: false
  };
  source.runtimeStatus.checks.browsers = [{
    name: 'chromium',
    executable_exists: true,
    executable_allowed: true,
    probe_ok: true
  }];
  const subject = runner(source, {
    scenarioRegistry: {
      resolve() {
        return {
          prompt,
          oracle_scenario: oracleScenario,
          scenario_data: { actual: true },
          interaction: { kind: 'act' }
        };
      }
    },
    midsceneAdapter: {
      validate() {
        return { ok: true, blockers: [] };
      },
      async interact(request) {
        fs.mkdirSync(request.artifact_root, { recursive: true });
        const screenshot = path.join(
          request.artifact_root,
          'screenshot.png'
        );
        const bytes = Buffer.from('png');
        fs.writeFileSync(screenshot, bytes);
        const artifact = {
          kind: 'screenshot',
          path: screenshot,
          producer: 'midscene-runner',
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          size: bytes.length
        };
        return {
          status: 'observed',
          observation: {
            description: 'The approved payroll status is visible.'
          },
          prompt: { id: 'prompt-midscene-production' },
          model: { name: 'injected-midscene-test-double' },
          screenshots: [artifact],
          artifacts: [artifact],
          assertions: [{
            id: 'ASSERT-1',
            method: 'equal',
            expected: true,
            actual: true,
            status: 'passed'
          }],
          console: [],
          network: [],
          blockers: [],
          timed_out: false,
          canceled: false,
          fallback_used: false
        };
      }
    }
  });

  const result = await subject.executeCase(source.testCase.id);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.status, 'passed');
  assert.equal(result.evidence.length, 2);
  assert.equal(
    result.evidence.every((entry) => entry.producer === 'midscene-runner'),
    true
  );
  assert.equal(result.readings.length, 6);
  assert.equal(result.integrity.ok, true);
});

test('artifact pipeline derives both gates, one report model and three HTML pages', async () => {
  const source = fixture();
  const execution = await runner(source).executeCase(source.testCase.id);
  assert.equal(execution.ok, true, JSON.stringify(execution.blockers));
  const subject = kernel.createVerificationArtifactPipeline({
    kernel,
    schemaRegistry: source.schemaRegistry,
    changeRoot: source.changeRoot,
    verificationRoot: source.verificationRoot,
    snapshot: source.snapshot,
    approval: source.approval,
    currentFingerprints: currentFingerprints(source),
    trustedFactAuthority: source.trustedFactAuthority,
    clock: clock(),
    secrets: []
  });

  const result = subject.build();

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.release_gate.decision, 'pass');
  assert.equal(result.archive_gate.decision, 'pass');
  assert.equal(result.report_model.verdict, 'green');
  for (const name of kernel.REPORT_FILES) {
    assert.equal(
      fs.existsSync(path.join(source.verificationRoot, 'reports', name)),
      true,
      name
    );
  }
  assert.equal(result.report_manifest.reports.length, 3);
});

test('freshness selects the latest completed attempt when sequences match', () => {
  const snapshot = {
    change_id: 'change-production',
    cases: [{ id: 'CASE-01' }]
  };
  const attempts = [{
    id: 'attempt-failed',
    run_id: 'run-failed',
    case_id: 'CASE-01',
    sequence: 2,
    started_at: '2026-08-06T00:00:00Z',
    completed_at: '2026-08-06T00:01:00Z'
  }, {
    id: 'attempt-passed',
    run_id: 'run-passed',
    case_id: 'CASE-01',
    sequence: 2,
    started_at: '2026-08-06T00:02:00Z',
    completed_at: '2026-08-06T00:03:00Z'
  }];
  const runs = attempts.map((attempt) => ({
    id: attempt.run_id,
    case_snapshot_hash: 'snapshot-hash',
    code_sha: 'code-sha',
    test_sha: 'test-sha',
    environment_hash: 'environment-hash',
    runtime_version: 'runtime-version',
    kernel_version: 'kernel-version'
  }));
  for (const attempt of attempts) {
    Object.assign(attempt, {
      case_snapshot_hash: 'snapshot-hash',
      code_sha: 'code-sha',
      test_sha: 'test-sha',
      environment_hash: 'environment-hash',
      runtime_version: 'runtime-version',
      kernel_version: 'kernel-version'
    });
  }

  const result = freshnessProjection(
    snapshot,
    runs,
    attempts,
    {
      case_snapshot_hash: 'snapshot-hash',
      code_sha: 'code-sha',
      test_sha: 'test-sha',
      environment_hash: 'environment-hash',
      runtime_version: 'runtime-version',
      kernel_version: 'kernel-version'
    },
    '2026-08-06T00:04:00Z'
  );

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.cases[0].attempt_id, 'attempt-passed');
});

test('freshness selects a newer initial attempt over an older retest sequence', () => {
  const snapshot = {
    change_id: 'change-production',
    cases: [{ id: 'CASE-01' }]
  };
  const attempts = [{
    id: 'attempt-old-retest',
    run_id: 'run-old-retest',
    case_id: 'CASE-01',
    sequence: 2,
    started_at: '2026-08-06T00:00:00Z',
    completed_at: '2026-08-06T00:01:00Z'
  }, {
    id: 'attempt-new-initial',
    run_id: 'run-new-initial',
    case_id: 'CASE-01',
    sequence: 1,
    started_at: '2026-08-09T00:00:00Z',
    completed_at: '2026-08-09T00:01:00Z'
  }];
  const current = {
    case_snapshot_hash: 'snapshot-hash',
    code_sha: 'current-code',
    test_sha: 'current-tests',
    environment_hash: 'environment-hash',
    runtime_version: 'runtime-version',
    kernel_version: 'kernel-version'
  };
  const runs = attempts.map((attempt, index) => ({
    id: attempt.run_id,
    case_snapshot_hash: 'snapshot-hash',
    code_sha: index === 0 ? 'old-code' : current.code_sha,
    test_sha: index === 0 ? 'old-tests' : current.test_sha,
    environment_hash: 'environment-hash',
    runtime_version: 'runtime-version',
    kernel_version: 'kernel-version'
  }));
  for (let index = 0; index < attempts.length; index += 1) {
    Object.assign(attempts[index], {
      case_snapshot_hash: runs[index].case_snapshot_hash,
      code_sha: runs[index].code_sha,
      test_sha: runs[index].test_sha,
      environment_hash: runs[index].environment_hash,
      runtime_version: runs[index].runtime_version,
      kernel_version: runs[index].kernel_version
    });
  }

  const result = freshnessProjection(
    snapshot,
    runs,
    attempts,
    current,
    '2026-08-09T00:02:00Z'
  );

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.cases[0].attempt_id, 'attempt-new-initial');
});

test('code inventory fingerprint ignores governance artifacts but tracks source', () => {
  const base = [
    '100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tplugins/runtime.js',
    '100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\ttests/runtime.test.js',
    '100644 blob cccccccccccccccccccccccccccccccccccccccc\topenspec/changes/change-production/verify/v2/runs.json',
    '100644 blob dddddddddddddddddddddddddddddddddddddddd\t.codegraph/index.json'
  ].join('\n');
  const governanceOnly = [
    '100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tplugins/runtime.js',
    '100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\ttests/runtime.test.js',
    '100644 blob eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\topenspec/changes/change-production/verify/v2/runs.json',
    '100644 blob ffffffffffffffffffffffffffffffffffffffff\t.codegraph/index.json'
  ].join('\n');
  const sourceChanged = governanceOnly.replace(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '1111111111111111111111111111111111111111'
  );

  assert.equal(
    kernel.codeInventorySha(base),
    kernel.codeInventorySha(governanceOnly)
  );
  assert.notEqual(
    kernel.codeInventorySha(base),
    kernel.codeInventorySha(sourceChanged)
  );
  assert.match(kernel.codeInventorySha(base), /^[a-f0-9]{40}$/);
});

test('artifact store rejects traversal and symlinked parent paths', () => {
  const source = fixture();
  const store = kernel.createVerificationArtifactStore({
    changeRoot: source.changeRoot,
    root: source.verificationRoot
  });
  const traversal = store.publishText('../escaped.txt', 'blocked');
  assert.equal(traversal.ok, false);
  assert.equal(
    traversal.blockers[0].id,
    'verification-persistence:path-outside-root'
  );

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-outside-'));
  fs.symlinkSync(outside, path.join(source.verificationRoot, 'unsafe'));
  const symlink = store.publishText('unsafe/escaped.txt', 'blocked');
  assert.equal(symlink.ok, false);
  assert.equal(
    symlink.blockers[0].id,
    'verification-persistence:path-unsafe'
  );
  assert.equal(fs.existsSync(path.join(outside, 'escaped.txt')), false);
});

test('artifact store rejects a symlinked change root before any write', (t) => {
  const outside = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-symlink-change-outside-'
  ));
  const parent = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-symlink-change-parent-'
  ));
  t.after(() => {
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const changeRoot = path.join(parent, 'change');
  fs.symlinkSync(outside, changeRoot);
  const store = kernel.createVerificationArtifactStore({
    changeRoot,
    root: path.join(changeRoot, 'verify')
  });

  const result = store.publishJson('escape.json', { forged: true });

  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(outside, 'verify', 'escape.json')), false);
});

test('artifact store returns a blocker when its root is deleted or replaced', (t) => {
  const source = fixture();
  const store = kernel.createVerificationArtifactStore({
    changeRoot: source.changeRoot,
    root: source.verificationRoot
  });
  const outside = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-replaced-root-outside-'
  ));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  fs.rmSync(source.verificationRoot, { recursive: true, force: true });
  const deleted = store.publishJson('v2/deleted-root.json', { ok: true });
  assert.equal(deleted.ok, false);
  assert.deepEqual(
    deleted.blockers.map((entry) => entry.id),
    ['verification-persistence:root-invalid']
  );

  fs.symlinkSync(outside, source.verificationRoot);
  const replaced = store.publishJson('v2/replaced-root.json', { ok: true });
  assert.equal(replaced.ok, false);
  assert.deepEqual(
    replaced.blockers.map((entry) => entry.id),
    ['verification-persistence:root-invalid']
  );
  assert.equal(
    fs.existsSync(path.join(outside, 'v2', 'replaced-root.json')),
    false
  );
});

test('artifact store refuses a symlinked append target', () => {
  const source = fixture();
  const external = path.join(source.projectRoot, 'external.jsonl');
  fs.writeFileSync(external, 'trusted\n');
  const store = kernel.createVerificationArtifactStore({
    changeRoot: source.changeRoot,
    root: source.verificationRoot
  });
  const target = path.join(source.verificationRoot, 'events.jsonl');
  fs.symlinkSync(external, target);

  const result = store.appendJsonl('events.jsonl', { id: 'event-1' });

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-persistence:path-unsafe'
      || entry.id === 'verification-persistence:append-failed'
    )),
    true
  );
  assert.equal(fs.readFileSync(external, 'utf8'), 'trusted\n');
});
