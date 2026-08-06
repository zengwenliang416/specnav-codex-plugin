'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXED_TIME = '2026-08-06T08:00:00.000Z';
const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../contracts/fixtures/positive'
);
const SIGNING_KEY = Buffer.alloc(32, 7);

function failureFixture() {
  return JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, 'failure-packet.json'),
    'utf8'
  ));
}

function rootFailureFixture() {
  return {
    ...failureFixture(),
    classification: null,
    status: 'open',
    next_action: 'blocked_for_decision',
    owner: 'verification'
  };
}

function effectiveFailure(root) {
  return {
    ...root,
    classification: 'test_defect',
    status: 'repair_required',
    next_action: 'repair_required',
    owner: 'development'
  };
}

function authority(registry) {
  return createTrustedFactAuthority({
    schemaRegistry: registry,
    key: SIGNING_KEY,
    clock: () => FIXED_TIME
  });
}

function envelopeBindings(failure, sequence = null, previous = null) {
  return {
    failure_id: failure.id,
    change_id: failure.change_id,
    run_id: failure.run_id,
    case_id: failure.case_id,
    ...(sequence === null
      ? {}
      : {
          log_sequence: sequence,
          previous_envelope_digest: previous
        })
  };
}

function classificationEnvelope(trust, root, effective) {
  return trust.seal('classification_result', {
    ok: true,
    status: 'classified',
    packet: effective,
    signals: [],
    blockers: []
  }, envelopeBindings(root));
}

function proposalFixture(registry, failure, overrides = {}) {
  return registry.assertValid('transition-proposal', {
    schema: 'specnav.verification.transition-proposal.v1',
    id: 'transition-close',
    failure_id: failure.id,
    change_id: failure.change_id,
    action: 'close_failure',
    owner: 'core',
    from_state: 'closure_ready',
    target_state: 'closed',
    case_ids: [failure.case_id],
    attempt_ids: [failure.attempt_id],
    reason_ids: ['required-regression-passed'],
    proposed_at: FIXED_TIME,
    ...overrides
  });
}

test('trusted fact authority seals and verifies exact Kernel-owned payload bytes', () => {
  const registry = readySchemaRegistry();
  const trust = authority(registry);
  const root = rootFailureFixture();
  const effective = effectiveFailure(root);
  const envelope = classificationEnvelope(trust, root, effective);
  const verified = trust.verify(envelope);

  assert.equal(verified.ok, true);
  assert.equal(verified.envelope_id, envelope.id);
  const tampered = structuredClone(envelope);
  tampered.payload.packet.root_cause = 'forged';
  assert.equal(trust.verify(tampered).ok, false);
});

test('transition applier accepts only a signed proposal-log fact', () => {
  const registry = readySchemaRegistry();
  const trust = authority(registry);
  const root = rootFailureFixture();
  const effective = effectiveFailure(root);
  const proposal = proposalFixture(registry, root);
  const proposalEnvelope = trust.seal(
    'transition_proposal',
    proposal,
    envelopeBindings(root, 1, null)
  );
  const applier = createTransitionApplier({
    schemaRegistry: registry,
    trustVerifier: trust,
    clock: () => FIXED_TIME
  });
  const result = applier.apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: proposal.id,
    idempotency_key: 'apply-close-failure',
    proposal_envelopes: [proposalEnvelope],
    receipt_envelopes: []
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.failure.id, root.id);
  assert.equal(result.failure.status, 'closed');
  assert.match(result.receipt.projection_digest, /^[a-f0-9]{64}$/);
  assert.equal(result.receipt.idempotency_key, 'apply-close-failure');
  assert.match(result.receipt.proposal_digest, /^[a-f0-9]{64}$/);
  assert.equal(
    result.receipt.root_failure_digest,
    sha256(canonicalJson(root))
  );

  const receiptEnvelope = trust.seal(
    'transition_application',
    result.receipt,
    envelopeBindings(root, 1, null)
  );
  const replay = applier.apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: proposal.id,
    idempotency_key: 'apply-close-failure',
    proposal_envelopes: [proposalEnvelope],
    receipt_envelopes: [receiptEnvelope]
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.status, 'already_applied');
  assert.deepEqual(replay.receipt, result.receipt);

  const forged = applier.apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: 'transition-forged-by-caller',
    idempotency_key: 'apply-forged',
    proposal_envelopes: [proposalEnvelope],
    receipt_envelopes: []
  });
  assert.deepEqual(
    forged.blockers.map((entry) => entry.id),
    ['verification-transition:proposal-not-authorized']
  );

  const conflictingProposal = proposalFixture(registry, root, {
    id: 'transition-reopen',
    action: 'reopen_failure',
    from_state: 'reopen_required',
    target_state: 'reopened',
    reason_ids: ['regression-failed']
  });
  const conflictingEnvelope = trust.seal(
    'transition_proposal',
    conflictingProposal,
    envelopeBindings(
      root,
      2,
      sha256(canonicalJson(proposalEnvelope))
    )
  );
  assert.deepEqual(
    applier.apply({
      root_failure: root,
      effective_failure: effective,
      proposal_id: conflictingProposal.id,
      idempotency_key: 'apply-close-failure',
      proposal_envelopes: [proposalEnvelope, conflictingEnvelope],
      receipt_envelopes: [receiptEnvelope]
    }).blockers.map((entry) => entry.id),
    ['verification-transition:idempotency-conflict']
  );

  const tamperedReceipt = structuredClone(receiptEnvelope);
  tamperedReceipt.payload.to_status = 'reopened';
  assert.deepEqual(
    applier.apply({
      root_failure: root,
      effective_failure: effective,
      proposal_id: proposal.id,
      idempotency_key: 'apply-other',
      proposal_envelopes: [proposalEnvelope],
      receipt_envelopes: [tamperedReceipt]
    }).blockers.map((entry) => entry.id),
    ['verification-transition:receipt-invalid']
  );
});

test('transition applier rejects a signed replay whose action and target do not match the authorized proposal', () => {
  const registry = readySchemaRegistry();
  const trust = authority(registry);
  const root = rootFailureFixture();
  const effective = effectiveFailure(root);
  const proposal = proposalFixture(registry, root);
  const proposalEnvelope = trust.seal(
    'transition_proposal',
    proposal,
    envelopeBindings(root, 1, null)
  );
  const applier = createTransitionApplier({
    schemaRegistry: registry,
    trustVerifier: trust,
    clock: () => FIXED_TIME
  });
  const applied = applier.apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: proposal.id,
    idempotency_key: 'apply-close-failure',
    proposal_envelopes: [proposalEnvelope],
    receipt_envelopes: []
  });
  assert.equal(applied.ok, true, JSON.stringify(applied.blockers));

  const reopened = {
    ...applied.receipt,
    action: 'reopen_failure',
    to_status: 'reopened',
    projection_digest: sha256(canonicalJson({
      ...effective,
      status: 'reopened'
    }))
  };
  const reopenedEnvelope = trust.seal(
    'transition_application',
    reopened,
    envelopeBindings(root, 1, null)
  );
  const result = applier.apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: proposal.id,
    idempotency_key: reopened.idempotency_key,
    proposal_envelopes: [proposalEnvelope],
    receipt_envelopes: [reopenedEnvelope]
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(
    result.blockers.map((entry) => entry.id),
    ['verification-transition:receipt-invalid']
  );
});

test('transition applier rejects a signed historical receipt bound to a foreign proposal', () => {
  const registry = readySchemaRegistry();
  const trust = authority(registry);
  const root = rootFailureFixture();
  const effective = effectiveFailure(root);
  const proposal = proposalFixture(registry, root);
  const foreignRoot = {
    ...root,
    id: 'failure-foreign',
    change_id: 'change-foreign'
  };
  const foreignProposal = proposalFixture(registry, foreignRoot, {
    id: 'transition-foreign'
  });
  const proposalEnvelope = trust.seal(
    'transition_proposal',
    proposal,
    envelopeBindings(root, 1, null)
  );
  const foreignProposalEnvelope = trust.seal(
    'transition_proposal',
    foreignProposal,
    envelopeBindings(foreignRoot, 1, null)
  );
  const foreignReceipt = {
    schema: 'specnav.verification.transition-application.v1',
    id: 'transition-foreign-receipt',
    idempotency_key: 'historical-foreign',
    proposal_id: foreignProposal.id,
    proposal_digest: sha256(canonicalJson(foreignProposal)),
    root_failure_digest: sha256(canonicalJson(root)),
    failure_id: root.id,
    change_id: root.change_id,
    action: 'close_failure',
    from_status: effective.status,
    to_status: 'closed',
    projection_digest: sha256(canonicalJson({
      ...effective,
      status: 'closed'
    })),
    applied_at: FIXED_TIME
  };
  const foreignReceiptEnvelope = trust.seal(
    'transition_application',
    foreignReceipt,
    envelopeBindings(root, 1, null)
  );
  const result = createTransitionApplier({
    schemaRegistry: registry,
    trustVerifier: trust,
    clock: () => FIXED_TIME
  }).apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: proposal.id,
    idempotency_key: 'apply-after-foreign-history',
    proposal_envelopes: [proposalEnvelope, foreignProposalEnvelope],
    receipt_envelopes: [foreignReceiptEnvelope]
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(
    result.blockers.map((entry) => entry.id),
    ['verification-transition:receipt-invalid']
  );
});

test('transition applier rejects a signed receipt that breaks the from_status chain', () => {
  const registry = readySchemaRegistry();
  const trust = authority(registry);
  const root = rootFailureFixture();
  const effective = effectiveFailure(root);
  const proposal = proposalFixture(registry, root);
  const proposalEnvelope = trust.seal(
    'transition_proposal',
    proposal,
    envelopeBindings(root, 1, null)
  );
  const receipt = {
    schema: 'specnav.verification.transition-application.v1',
    id: 'transition-broken-chain',
    idempotency_key: 'apply-broken-chain',
    proposal_id: proposal.id,
    proposal_digest: sha256(canonicalJson(proposal)),
    root_failure_digest: sha256(canonicalJson(root)),
    failure_id: root.id,
    change_id: root.change_id,
    action: proposal.action,
    from_status: 'open',
    to_status: proposal.target_state,
    projection_digest: sha256(canonicalJson({
      ...effective,
      status: proposal.target_state
    })),
    applied_at: FIXED_TIME
  };
  const receiptEnvelope = trust.seal(
    'transition_application',
    receipt,
    envelopeBindings(root, 1, null)
  );
  const result = createTransitionApplier({
    schemaRegistry: registry,
    trustVerifier: trust,
    clock: () => FIXED_TIME
  }).apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: proposal.id,
    idempotency_key: receipt.idempotency_key,
    proposal_envelopes: [proposalEnvelope],
    receipt_envelopes: [receiptEnvelope]
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(
    result.blockers.map((entry) => entry.id),
    ['verification-transition:receipt-invalid']
  );
});

test('failure state reducer keeps roots immutable and supersedes valid follow-up failures', () => {
  const registry = readySchemaRegistry();
  const trust = authority(registry);
  const root = rootFailureFixture();
  const effective = effectiveFailure(root);
  const rootRun = JSON.parse(fs.readFileSync(
    path.join(FIXTURE_ROOT, 'verification-run.json'),
    'utf8'
  ));
  const followupRun = {
    ...rootRun,
    id: 'run-followup',
    case_ids: [root.case_id],
    kind: 'retest',
    origin_run_id: root.run_id,
    parent_run_id: root.run_id,
    parent_attempt_id: root.attempt_id,
    failure_id: root.id
  };
  const duplicate = {
    ...root,
    id: 'failure-followup-duplicate',
    run_id: followupRun.id,
    attempt_id: 'attempt-followup'
  };
  const classification = classificationEnvelope(trust, root, effective);
  const proposal = proposalFixture(registry, root);
  const proposalEnvelope = trust.seal(
    'transition_proposal',
    proposal,
    envelopeBindings(root, 1, null)
  );
  const applied = createTransitionApplier({
    schemaRegistry: registry,
    trustVerifier: trust,
    clock: () => FIXED_TIME
  }).apply({
    root_failure: root,
    effective_failure: effective,
    proposal_id: proposal.id,
    idempotency_key: 'apply-close-failure',
    proposal_envelopes: [proposalEnvelope],
    receipt_envelopes: []
  });
  assert.equal(applied.ok, true, JSON.stringify(applied.blockers));
  const receiptEnvelope = trust.seal(
    'transition_application',
    applied.receipt,
    envelopeBindings(root, 1, null)
  );

  const result = createFailureStateReducer({
    schemaRegistry: registry,
    trustVerifier: trust
  }).reduce({
    expected_change_id: root.change_id,
    failures: [root, duplicate],
    raw_failures: [root, duplicate],
    runs: [rootRun, followupRun],
    classification_envelopes: [classification],
    transition_proposal_envelopes: [proposalEnvelope],
    transition_receipt_envelopes: [receiptEnvelope]
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.open_failure_ids, []);
  assert.equal(
    result.states.find((entry) => entry.failure_id === root.id).logical_status,
    'closed'
  );
  assert.equal(
    result.states.find(
      (entry) => entry.failure_id === duplicate.id
    ).logical_status,
    'superseded'
  );
  assert.equal(root.status, 'open');
});
