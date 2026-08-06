'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const TARGET_STATUS = Object.freeze({
  close_failure: 'closed',
  reopen_failure: 'reopened',
  route_break_loop: 'break_loop'
});

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function blocked(value) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    failure: null,
    receipt: null,
    blockers: [value]
  });
}

function validDate(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function schemaValue(schemaRegistry, entityType, value) {
  try {
    const result = schemaRegistry.validate(entityType, value);
    return result?.ok === true ? result.value : null;
  } catch {
    return null;
  }
}

function verifiedEnvelope(
  schemaRegistry,
  trustVerifier,
  envelope,
  expectedKind
) {
  const value = schemaValue(
    schemaRegistry,
    'trusted-fact-envelope',
    envelope
  );
  let verified = null;
  try {
    verified = value ? trustVerifier.verify(value) : null;
  } catch {
    verified = null;
  }
  return value
    && verified?.ok === true
    && value.kind === expectedKind
    ? value
    : null;
}

function trustedProposal(schemaRegistry, trustVerifier, envelope) {
  const value = verifiedEnvelope(
    schemaRegistry,
    trustVerifier,
    envelope,
    'transition_proposal'
  );
  return value
    ? schemaValue(schemaRegistry, 'transition-proposal', value.payload)
    : null;
}

function proposalBindsRoot(proposal, root) {
  return proposal
    && proposal.failure_id === root.id
    && proposal.change_id === root.change_id
    && Object.hasOwn(TARGET_STATUS, proposal.action)
    && proposal.target_state === TARGET_STATUS[proposal.action];
}

function createTransitionApplier(options = {}) {
  const {
    schemaRegistry,
    trustVerifier,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !trustVerifier
    || typeof trustVerifier.verify !== 'function'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-transition:config-invalid');
  }

  function apply(request) {
    const root = schemaValue(
      schemaRegistry,
      'failure-packet',
      request?.root_failure
    );
    const effective = schemaValue(
      schemaRegistry,
      'failure-packet',
      request?.effective_failure
    );
    if (
      !root
      || root.classification !== null
      || root.status !== 'open'
      || !effective
      || effective.id !== root.id
      || effective.change_id !== root.change_id
      || effective.run_id !== root.run_id
      || effective.case_id !== root.case_id
      || effective.attempt_id !== root.attempt_id
      || effective.classification === null
      || typeof request?.proposal_id !== 'string'
      || typeof request?.idempotency_key !== 'string'
      || request.idempotency_key.length === 0
      || !Array.isArray(request.proposal_envelopes)
      || !Array.isArray(request.receipt_envelopes)
    ) {
      return blocked(blocker(
        'verification-transition:request-invalid',
        'transition-request'
      ));
    }

    const proposalMatches = request.proposal_envelopes
      .map((envelope) => ({
        envelope,
        proposal: trustedProposal(schemaRegistry, trustVerifier, envelope)
      }))
      .filter((entry) => entry.proposal?.id === request.proposal_id);
    if (proposalMatches.length !== 1) {
      return blocked(blocker(
        'verification-transition:proposal-not-authorized',
        request.proposal_id
      ));
    }
    const proposal = proposalMatches[0].proposal;
    if (!proposalBindsRoot(proposal, root)) {
      return blocked(blocker(
        'verification-transition:proposal-binding-invalid',
        proposal.id
      ));
    }

    const rootDigest = sha256(canonicalJson(root));
    const proposalDigest = sha256(canonicalJson(proposal));
    const receipts = [];
    for (const rawEnvelope of request.receipt_envelopes) {
      const envelope = verifiedEnvelope(
        schemaRegistry,
        trustVerifier,
        rawEnvelope,
        'transition_application'
      );
      const receipt = envelope
        ? schemaValue(
            schemaRegistry,
            'transition-application',
            envelope.payload
          )
        : null;
      if (
        !receipt
        || receipt.failure_id !== root.id
        || receipt.change_id !== root.change_id
        || receipt.root_failure_digest !== rootDigest
        || receipt.to_status !== TARGET_STATUS[receipt.action]
      ) {
        return blocked(blocker(
          'verification-transition:receipt-invalid',
          receipt?.id || rawEnvelope?.id || 'transition-application'
        ));
      }
      receipts.push(receipt);
    }

    const idempotencyKeys = new Set();
    const proposalIds = new Set();
    let current = effective;
    for (const receipt of receipts) {
      const authorizedMatches = request.proposal_envelopes
        .map((envelope) => ({
          envelope,
          proposal: trustedProposal(schemaRegistry, trustVerifier, envelope)
        }))
        .filter((entry) => entry.proposal?.id === receipt.proposal_id);
      const authorized = authorizedMatches.length === 1
        ? authorizedMatches[0].proposal
        : null;
      const targetStatus = authorized
        ? TARGET_STATUS[authorized.action]
        : null;
      const projected = schemaValue(schemaRegistry, 'failure-packet', {
        ...effective,
        status: targetStatus
      });
      if (
        !authorized
        || authorizedMatches.length !== 1
        || !proposalBindsRoot(authorized, root)
        || receipt.proposal_digest !== sha256(canonicalJson(authorized))
        || receipt.failure_id !== authorized.failure_id
        || receipt.change_id !== authorized.change_id
        || receipt.action !== authorized.action
        || receipt.to_status !== authorized.target_state
        || receipt.to_status !== targetStatus
        || receipt.from_status !== current.status
        || !projected
        || receipt.projection_digest !== sha256(canonicalJson(projected))
        || idempotencyKeys.has(receipt.idempotency_key)
        || proposalIds.has(receipt.proposal_id)
      ) {
        return blocked(blocker(
          'verification-transition:receipt-invalid',
          receipt.id
        ));
      }
      idempotencyKeys.add(receipt.idempotency_key);
      proposalIds.add(receipt.proposal_id);
      current = projected;
    }

    const replay = receipts.find((receipt) => (
      receipt.idempotency_key === request.idempotency_key
    ));
    if (replay) {
      if (
        replay.proposal_id !== proposal.id
        || replay.proposal_digest !== proposalDigest
      ) {
        return blocked(blocker(
          'verification-transition:idempotency-conflict',
          request.idempotency_key
        ));
      }
      return deepFreeze({
        ok: true,
        status: 'already_applied',
        failure: current,
        receipt: replay,
        blockers: []
      });
    }
    if (proposalIds.has(proposal.id)) {
      return blocked(blocker(
        'verification-transition:proposal-already-applied',
        proposal.id
      ));
    }

    const appliedAt = clock();
    if (!validDate(appliedAt)) {
      return blocked(blocker(
        'verification-transition:clock-invalid',
        'clock'
      ));
    }
    const projected = schemaValue(schemaRegistry, 'failure-packet', {
      ...effective,
      status: TARGET_STATUS[proposal.action]
    });
    if (!projected) {
      return blocked(blocker(
        'verification-transition:projection-invalid',
        root.id
      ));
    }
    const receiptFields = {
      schema: 'specnav.verification.transition-application.v1',
      idempotency_key: request.idempotency_key,
      proposal_id: proposal.id,
      proposal_digest: proposalDigest,
      root_failure_digest: rootDigest,
      failure_id: root.id,
      change_id: root.change_id,
      action: proposal.action,
      from_status: current.status,
      to_status: projected.status,
      projection_digest: sha256(canonicalJson(projected)),
      applied_at: appliedAt
    };
    const receipt = schemaValue(
      schemaRegistry,
      'transition-application',
      {
        ...receiptFields,
        id: `transition-application-${sha256(canonicalJson(
          receiptFields
        ))}`
      }
    );
    if (!receipt) {
      return blocked(blocker(
        'verification-transition:receipt-invalid',
        proposal.id
      ));
    }
    return deepFreeze({
      ok: true,
      status: 'applied',
      failure: projected,
      receipt,
      blockers: []
    });
  }

  return Object.freeze({ apply });
}

module.exports = {
  TARGET_STATUS,
  createTransitionApplier
};
