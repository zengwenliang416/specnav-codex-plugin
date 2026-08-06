'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification/kernel');
const {
  createFailureStateReducer,
  createTransitionApplier,
  createTrustedFactAuthority
} = require('../../../plugins/specnav-verification/kernel/repair');
const {
  canonicalJson,
  sha256
} = require('../../../plugins/specnav-verification/kernel/evidence/identity');
const {
  run
} = require('../../../plugins/specnav-verification/scripts/verification-v2-repair-loop');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../contracts/fixtures'
);
const FIXED_TIME = '2026-08-06T09:00:00.000Z';
const PUBLIC_RUNTIME_DIGEST = 'a'.repeat(64);
const PRIVATE_RUNTIME_SIGNING_KEY = Buffer.from(
  'security-boundary-test-private-runtime-signing-key',
  'utf8'
);

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, name),
    'utf8'
  ));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function failureFixture(overrides = {}) {
  return {
    ...fixture('positive/failure-packet.json'),
    ...overrides
  };
}

function rootFailureFixture(overrides = {}) {
  return failureFixture({
    classification: null,
    status: 'open',
    next_action: 'blocked_for_decision',
    owner: 'verification',
    ...overrides
  });
}

function effectiveFailure(root, overrides = {}) {
  return {
    ...root,
    classification: 'test_defect',
    status: 'repair_required',
    next_action: 'repair_required',
    owner: 'development',
    ...overrides
  };
}

function trustAuthority(registry = readySchemaRegistry()) {
  return createTrustedFactAuthority({
    schemaRegistry: registry,
    key: PRIVATE_RUNTIME_SIGNING_KEY,
    clock: () => FIXED_TIME
  });
}

function reducerRequest(overrides = {}) {
  const failure = overrides.failure || rootFailureFixture();
  return {
    expected_change_id: failure.change_id,
    failures: [failure],
    raw_failures: [failure],
    runs: [runFixture()],
    classification_envelopes: [],
    transition_proposal_envelopes: [],
    transition_receipt_envelopes: [],
    ...overrides
  };
}

function runFixture(overrides = {}) {
  return {
    ...fixture('positive/verification-run.json'),
    ...overrides
  };
}

function assertBlocked(result, message) {
  assert.equal(result?.ok, false, `${message}: ${JSON.stringify(result)}`);
  assert.ok(
    Array.isArray(result?.blockers) && result.blockers.length > 0,
    `${message}: expected a blocker`
  );
}

function repairCliProjectFixture() {
  const projectRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-security-boundary-'
  ));
  const changeId = 'change-v2';
  const changeRoot = path.join(projectRoot, 'openspec', 'changes', changeId);
  const verificationRoot = path.join(changeRoot, 'verify');
  const v2 = path.join(verificationRoot, 'v2');

  fs.mkdirSync(path.join(projectRoot, 'openspec', '.specnav'), {
    recursive: true
  });
  fs.writeFileSync(
    path.join(projectRoot, 'openspec', '.specnav', 'active-change'),
    `${changeId}\n`
  );

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
  writeJson(
    path.join(verificationRoot, 'evidence', 'index.json'),
    evidenceIndex
  );
  writeJson(
    path.join(
      verificationRoot,
      'runs',
      runValue.id,
      'attempts',
      attempt.id,
      'integrity.json'
    ),
    integrity
  );
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
    id: 'root-cause-check-security-boundary',
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

  return {
    projectRoot,
    changeId,
    failure,
    rootCauseFile,
    classificationEnvelopeFile: path.join(
      verificationRoot,
      'repairs',
      failure.id,
      'classification-envelope.json'
    )
  };
}

function repairCliDependencies() {
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
            digest: PUBLIC_RUNTIME_DIGEST
          },
          signingKey: PRIVATE_RUNTIME_SIGNING_KEY,
          blockers: []
        };
      }
    }
  };
}

function repairCliArgs(source, action) {
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

function publiclyReconstructedRepairKey(source) {
  return crypto.createHash('sha256')
    .update(PUBLIC_RUNTIME_DIGEST)
    .update('\0')
    .update(fs.realpathSync(source.projectRoot))
    .update('\0')
    .update(source.changeId)
    .update('\0')
    .update(kernel.metadata.contractDigest)
    .digest();
}

function forgeEnvelopeWithKey(envelope, key) {
  const unsigned = structuredClone(envelope);
  delete unsigned.signature;
  unsigned.payload.packet.classification = 'environment_defect';
  unsigned.payload.packet.status = 'retry_allowed';
  unsigned.payload.packet.next_action = 'retry_allowed';
  unsigned.payload.packet.owner = 'verification';
  unsigned.payload_digest = sha256(canonicalJson(unsigned.payload));
  unsigned.id = `trusted-fact-${sha256(canonicalJson({
    kind: unsigned.kind,
    payload_digest: unsigned.payload_digest,
    bindings: unsigned.bindings
  }))}`;
  return {
    ...unsigned,
    signature: crypto.createHmac('sha256', key)
      .update(canonicalJson(unsigned))
      .digest('hex')
  };
}

function proposalFor(failure, overrides = {}) {
  return readySchemaRegistry().assertValid('transition-proposal', {
    schema: 'specnav.verification.transition-proposal.v1',
    id: 'transition-forged-by-caller',
    failure_id: failure.id,
    change_id: failure.change_id,
    action: 'close_failure',
    owner: 'core',
    from_state: 'closure_ready',
    target_state: 'closed',
    case_ids: [failure.case_id],
    attempt_ids: [failure.attempt_id],
    reason_ids: ['manual-green'],
    proposed_at: FIXED_TIME,
    ...overrides
  });
}

function receiptFor(failure, overrides = {}) {
  const statusByAction = {
    close_failure: 'closed',
    reopen_failure: 'reopened',
    route_break_loop: 'break_loop'
  };
  const action = overrides.action || 'close_failure';
  const projected = {
    ...failure,
    status: statusByAction[action]
  };
  return {
    schema: 'specnav.verification.transition-application.v1',
    id: 'transition-receipt-security-boundary',
    idempotency_key: 'apply-security-boundary',
    proposal_id: 'transition-security-boundary',
    proposal_digest: 'b'.repeat(64),
    root_failure_digest: sha256(canonicalJson(failure)),
    failure_id: failure.id,
    change_id: failure.change_id,
    action,
    from_status: failure.status,
    to_status: statusByAction[action],
    projection_digest: sha256(canonicalJson(projected)),
    applied_at: FIXED_TIME,
    ...overrides
  };
}

test('public runtime metadata cannot be used to forge a trusted classification envelope', async () => {
  const source = repairCliProjectFixture();
  const dependencies = repairCliDependencies();
  const classified = await run([
    ...repairCliArgs(source, 'classify'),
    '--root-cause-check',
    path.relative(source.projectRoot, source.rootCauseFile)
  ], dependencies);

  assert.equal(classified.ok, true, JSON.stringify(classified.blockers));
  const legitimate = JSON.parse(fs.readFileSync(
    source.classificationEnvelopeFile,
    'utf8'
  ));
  const forged = forgeEnvelopeWithKey(
    legitimate,
    publiclyReconstructedRepairKey(source)
  );
  writeJson(source.classificationEnvelopeFile, forged);

  const result = await run(
    repairCliArgs(source, 'state'),
    dependencies
  );

  assertBlocked(
    result,
    'a classification envelope signed with a public reconstruction key'
  );
  assert.deepEqual(
    result.blockers.map((entry) => entry.id),
    ['verification-repair-loop:trusted-envelope-unverified']
  );
});

test('transition applier rejects a caller-supplied forged proposal duplicated as expected_proposal', () => {
  const registry = readySchemaRegistry();
  const trust = trustAuthority(registry);
  const failure = rootFailureFixture();
  const forged = proposalFor(failure);
  const result = createTransitionApplier({
    schemaRegistry: registry,
    trustVerifier: trust,
    clock: () => FIXED_TIME
  }).apply({
    failure,
    proposal: forged,
    expected_proposal: structuredClone(forged),
    idempotency_key: 'apply-forged-proposal',
    existing_receipts: []
  });

  assertBlocked(
    result,
    'the caller must not authorize its own proposal by copying it'
  );
});

test('failure reducer rejects a root packet marked closed without a transition receipt', () => {
  const registry = readySchemaRegistry();
  const trust = trustAuthority(registry);
  const root = rootFailureFixture();
  const failure = {
    ...root,
    status: 'closed'
  };
  const result = createFailureStateReducer({
    schemaRegistry: registry,
    trustVerifier: trust
  }).reduce(reducerRequest({
    failure: root,
    failures: [failure],
    raw_failures: [root]
  }));

  assertBlocked(
    result,
    'root closure must be represented by an application receipt'
  );
});

test('failure reducer does not supersede a follow-up whose referenced root failure is orphaned', () => {
  const registry = readySchemaRegistry();
  const trust = trustAuthority(registry);
  const root = rootFailureFixture();
  const followupRun = runFixture({
    id: 'run-orphan-followup',
    kind: 'retest',
    origin_run_id: root.run_id,
    parent_run_id: root.run_id,
    parent_attempt_id: root.attempt_id,
    failure_id: 'failure-missing-root'
  });
  const followup = {
    ...root,
    id: 'failure-orphan-followup',
    run_id: followupRun.id,
    attempt_id: 'attempt-orphan-followup'
  };
  const result = createFailureStateReducer({
    schemaRegistry: registry,
    trustVerifier: trust
  }).reduce({
    expected_change_id: root.change_id,
    failures: [followup],
    raw_failures: [followup],
    runs: [followupRun],
    classification_envelopes: [],
    transition_proposal_envelopes: [],
    transition_receipt_envelopes: []
  });

  assertBlocked(
    result,
    'a follow-up without an existing root must not disappear as superseded'
  );
  assert.notEqual(
    result.states.find((entry) => entry.failure_id === followup.id)
      ?.logical_status,
    'superseded'
  );
});

test('failure reducer rejects a transition receipt whose action and to_status disagree', () => {
  const registry = readySchemaRegistry();
  const trust = trustAuthority(registry);
  const failure = rootFailureFixture();
  const effective = effectiveFailure(failure);
  const classification = trust.seal('classification_result', {
    ok: true,
    status: 'classified',
    packet: effective,
    signals: [],
    blockers: []
  }, {
    failure_id: failure.id,
    change_id: failure.change_id,
    run_id: failure.run_id,
    case_id: failure.case_id
  });
  const proposal = proposalFor(failure, {
    id: 'transition-security-boundary',
    reason_ids: ['required-regression-passed']
  });
  const proposalEnvelope = trust.seal(
    'transition_proposal',
    proposal,
    {
      failure_id: failure.id,
      change_id: failure.change_id,
      run_id: failure.run_id,
      case_id: failure.case_id,
      log_sequence: 1,
      previous_envelope_digest: null
    }
  );
  const receipt = receiptFor(failure, {
    proposal_id: proposal.id,
    proposal_digest: sha256(canonicalJson(proposal)),
    from_status: effective.status
  });
  const receiptEnvelope = trust.seal(
    'transition_application',
    receipt,
    {
      failure_id: failure.id,
      change_id: failure.change_id,
      run_id: failure.run_id,
      case_id: failure.case_id,
      log_sequence: 1,
      previous_envelope_digest: null
    }
  );
  const tampered = structuredClone(receiptEnvelope);
  tampered.payload.to_status = 'reopened';
  const result = createFailureStateReducer({
    schemaRegistry: registry,
    trustVerifier: trust
  }).reduce(reducerRequest({
    failure,
    classification_envelopes: [classification],
    transition_proposal_envelopes: [proposalEnvelope],
    transition_receipt_envelopes: [tampered]
  }));

  assertBlocked(
    result,
    'receipt status must be the status implied by its action'
  );
});

test('failure reducer rejects a root failure paired with a run from another change', () => {
  const registry = readySchemaRegistry();
  const trust = trustAuthority(registry);
  const failure = rootFailureFixture();
  const foreignRun = runFixture({
    change_id: 'change-foreign'
  });
  const result = createFailureStateReducer({
    schemaRegistry: registry,
    trustVerifier: trust
  }).reduce({
    expected_change_id: failure.change_id,
    failures: [failure],
    raw_failures: [failure],
    runs: [foreignRun],
    classification_envelopes: [],
    transition_proposal_envelopes: [],
    transition_receipt_envelopes: []
  });

  assertBlocked(
    result,
    'a root failure and its run must belong to the same change'
  );
});
