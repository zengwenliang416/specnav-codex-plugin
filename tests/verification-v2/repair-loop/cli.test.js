'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  run
} = require('../../../plugins/specnav-verification/scripts/verification-v2-repair-loop');
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
  const runValue = fixture('positive/verification-run.json');
  const attempt = {
    ...fixture('positive/attempt.json'),
    status: 'failed',
    exit_status: 1
  };
  const reading = {
    ...fixture('positive/reading.json'),
    actual: false,
    verdict: 'fail'
  };
  delete reading.step_id;
  reading.assertion_id = 'assertion-1';
  const evidence = fixture('ac31/evidence-baseline.json');
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
    rootCauseFile,
    scopeFile,
    verificationRoot
  };
}

function dependencies() {
  const schemaRegistry = readySchemaRegistry();
  return {
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
