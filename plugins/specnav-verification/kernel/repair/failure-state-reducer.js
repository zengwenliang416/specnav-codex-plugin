'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const ACTION_STATUS = Object.freeze({
  close_failure: 'closed',
  reopen_failure: 'reopened',
  route_break_loop: 'break_loop'
});

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function schemaValue(schemaRegistry, entityType, value) {
  try {
    const result = schemaRegistry.validate(entityType, value);
    return result?.ok === true ? result.value : null;
  } catch {
    return null;
  }
}

function compareReceipts(left, right) {
  return left.bindings.log_sequence - right.bindings.log_sequence;
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

function validRootFailure(schemaRegistry, failure, run, expectedChangeId) {
  const value = schemaValue(schemaRegistry, 'failure-packet', failure);
  return value
    && value.change_id === expectedChangeId
    && value.classification === null
    && value.status === 'open'
    && value.next_action === 'blocked_for_decision'
    && value.owner === 'verification'
    && run
    && run.change_id === expectedChangeId
    && run.kind === 'initial'
    && run.failure_id === null
    && run.origin_run_id === null
    && run.parent_run_id === null
    && run.case_ids.includes(value.case_id)
    ? value
    : null;
}

function validFollowupFailure(
  schemaRegistry,
  failure,
  run,
  root,
  runsById,
  expectedChangeId
) {
  const value = schemaValue(schemaRegistry, 'failure-packet', failure);
  const parentRun = run ? runsById.get(run.parent_run_id) : null;
  return value
    && value.change_id === expectedChangeId
    && value.classification === null
    && value.status === 'open'
    && value.next_action === 'blocked_for_decision'
    && value.owner === 'verification'
    && run
    && ['retry', 'retest', 'regression'].includes(run.kind)
    && run.change_id === expectedChangeId
    && run.failure_id === root?.id
    && run.origin_run_id === root?.run_id
    && typeof run.parent_run_id === 'string'
    && typeof run.parent_attempt_id === 'string'
    && parentRun
    && parentRun.change_id === expectedChangeId
    && (
      parentRun.id === root.run_id
      || parentRun.failure_id === root.id
    )
    && run.case_ids.includes(value.case_id)
    ? value
    : null;
}

function classifiedFailure(
  schemaRegistry,
  trustVerifier,
  root,
  envelopes
) {
  const matches = envelopes.filter((entry) => (
    entry?.bindings?.failure_id === root.id
  ));
  if (matches.length === 0) return null;
  if (matches.length !== 1) return null;
  const envelope = verifiedEnvelope(
    schemaRegistry,
    trustVerifier,
    matches[0],
    'classification_result'
  );
  const packet = envelope
    ? schemaValue(
        schemaRegistry,
        'failure-packet',
        envelope.payload.packet
      )
    : null;
  if (
    !packet
    || packet.id !== root.id
    || packet.change_id !== root.change_id
    || packet.run_id !== root.run_id
    || packet.case_id !== root.case_id
    || packet.attempt_id !== root.attempt_id
    || packet.created_at !== root.created_at
    || packet.frozen_at !== root.frozen_at
    || packet.classification === null
  ) return null;
  return { packet, envelope };
}

function validFollowupRun(run, root, runsById, expectedChangeId) {
  if (
    !run
    || !root
    || !['retest', 'regression'].includes(run.kind)
    || run.change_id !== expectedChangeId
    || run.failure_id !== root.id
    || run.origin_run_id !== root.run_id
    || typeof run.parent_run_id !== 'string'
    || typeof run.parent_attempt_id !== 'string'
  ) return false;
  const parentRun = runsById.get(run.parent_run_id);
  return Boolean(
    parentRun
    && parentRun.change_id === expectedChangeId
    && (
      parentRun.id === root.run_id
      || (
        ['retest', 'regression'].includes(parentRun.kind)
        && parentRun.failure_id === root.id
        && parentRun.origin_run_id === root.run_id
      )
    )
  );
}

function createFailureStateReducer(options = {}) {
  const { schemaRegistry, trustVerifier } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !trustVerifier
    || typeof trustVerifier.verify !== 'function'
  ) {
    throw new Error('verification-failure-state:config-invalid');
  }

  function reduce(request) {
    if (
      typeof request?.expected_change_id !== 'string'
      || !Array.isArray(request?.failures)
      || !Array.isArray(request?.raw_failures)
      || !Array.isArray(request?.runs)
      || !Array.isArray(request?.classification_envelopes)
      || !Array.isArray(request?.transition_proposal_envelopes)
      || !Array.isArray(request?.transition_receipt_envelopes)
    ) {
      return deepFreeze({
        ok: false,
        states: [],
        effective_failures: [],
        open_failure_ids: [],
        blockers: [blocker(
          'verification-failure-state:request-invalid',
          'failure-state'
        )]
      });
    }

    const blockers = [];
    const runsById = new Map();
    for (const rawRun of request.runs) {
      const run = schemaValue(
        schemaRegistry,
        'verification-run',
        rawRun
      );
      if (
        !run
        || run.change_id !== request.expected_change_id
        || runsById.has(run.id)
      ) {
        blockers.push(blocker(
          'verification-failure-state:run-invalid',
          rawRun?.id || 'verification-run'
        ));
        continue;
      }
      runsById.set(run.id, run);
    }

    const rawById = new Map();
    for (const rawFailure of request.raw_failures) {
      const failure = schemaValue(
        schemaRegistry,
        'failure-packet',
        rawFailure
      );
      if (
        !failure
        || failure.change_id !== request.expected_change_id
        || rawById.has(failure.id)
      ) {
        blockers.push(blocker(
          'verification-failure-state:raw-failure-invalid',
          rawFailure?.id || 'failure-packet'
        ));
        continue;
      }
      rawById.set(failure.id, failure);
    }

    const projectedById = new Map();
    for (const projected of request.failures) {
      const value = schemaValue(
        schemaRegistry,
        'failure-packet',
        projected
      );
      const raw = rawById.get(projected?.id);
      if (
        !value
        || !raw
        || canonicalJson(raw) !== canonicalJson(value)
        || value.change_id !== request.expected_change_id
        || projectedById.has(value.id)
      ) {
        blockers.push(blocker(
          'verification-failure-state:failure-projection-invalid',
          projected?.id || 'failure-packet'
        ));
        continue;
      }
      projectedById.set(value.id, value);
    }

    const roots = [];
    const rootIds = new Set();
    for (const projected of projectedById.values()) {
      const run = runsById.get(projected.run_id);
      const root = validRootFailure(
        schemaRegistry,
        projected,
        run,
        request.expected_change_id
      );
      if (
        !root
        || rootIds.has(root.id)
      ) {
        if (run?.kind === 'initial') {
          blockers.push(blocker(
            'verification-failure-state:root-failure-invalid',
            projected.id
          ));
        }
        continue;
      }
      rootIds.add(root.id);
      roots.push(root);
    }

    for (const run of runsById.values()) {
      if (!['retest', 'regression'].includes(run.kind)) continue;
      const root = projectedById.get(run.failure_id);
      if (!validFollowupRun(
        run,
        root,
        runsById,
        request.expected_change_id
      )) {
        blockers.push(blocker(
          'verification-failure-state:followup-run-invalid',
          run.id
        ));
      }
    }

    const followups = [];
    const followupIds = new Set();
    for (const projected of projectedById.values()) {
      if (rootIds.has(projected.id)) continue;
      const run = runsById.get(projected.run_id);
      const root = run ? projectedById.get(run.failure_id) : null;
      const followup = validFollowupFailure(
        schemaRegistry,
        projected,
        run,
        root,
        runsById,
        request.expected_change_id
      );
      if (!followup || followupIds.has(followup.id)) {
        blockers.push(blocker(
          'verification-failure-state:followup-failure-invalid',
          projected.id
        ));
        continue;
      }
      followupIds.add(followup.id);
      followups.push({ failure: followup, root });
    }
    for (const raw of rawById.values()) {
      if (!rootIds.has(raw.id) && !followupIds.has(raw.id)) {
        blockers.push(blocker(
          'verification-failure-state:raw-failure-orphaned',
          raw.id
        ));
      }
    }

    const proposalsById = new Map();
    for (const rawEnvelope of request.transition_proposal_envelopes) {
      const envelope = verifiedEnvelope(
        schemaRegistry,
        trustVerifier,
        rawEnvelope,
        'transition_proposal'
      );
      const proposal = envelope
        ? schemaValue(
            schemaRegistry,
            'transition-proposal',
            envelope.payload
          )
        : null;
      if (
        !proposal
        || proposal.change_id !== request.expected_change_id
        || proposalsById.has(proposal.id)
      ) {
        blockers.push(blocker(
          'verification-failure-state:proposal-invalid',
          proposal?.id || rawEnvelope?.id || 'transition-proposal'
        ));
        continue;
      }
      proposalsById.set(proposal.id, { envelope, proposal });
    }

    const receiptEnvelopes = [];
    for (const rawEnvelope of request.transition_receipt_envelopes) {
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
      const proposalState = receipt
        ? proposalsById.get(receipt.proposal_id)
        : null;
      if (
        !receipt
        || receipt.change_id !== request.expected_change_id
        || !proposalState
        || receipt.proposal_digest
          !== sha256(canonicalJson(proposalState.proposal))
        || receipt.action !== proposalState.proposal.action
        || receipt.to_status !== ACTION_STATUS[receipt.action]
        || receipt.failure_id !== proposalState.proposal.failure_id
      ) {
        blockers.push(blocker(
          'verification-failure-state:receipt-invalid',
          receipt?.id || rawEnvelope?.id || 'transition-application'
        ));
        continue;
      }
      receiptEnvelopes.push({ envelope, receipt });
    }

    const states = [];
    const effectiveFailures = [];
    for (const root of roots) {
      const classified = classifiedFailure(
        schemaRegistry,
        trustVerifier,
        root,
        request.classification_envelopes
      );
      if (!classified) {
        blockers.push(blocker(
          'verification-failure-state:classification-missing-or-invalid',
          root.id
        ));
        states.push({
          failure_id: root.id,
          root_failure_digest: sha256(canonicalJson(root)),
          classification_envelope_id: null,
          logical_status: 'unclassified',
          transition_receipt_id: null
        });
        effectiveFailures.push(root);
        continue;
      }
      const receipts = receiptEnvelopes
        .filter(({ receipt }) => receipt.failure_id === root.id)
        .sort((left, right) => compareReceipts(
          left.envelope,
          right.envelope
        ));
      const idempotencyKeys = new Set();
      const proposalIds = new Set();
      let current = classified.packet;
      let latestReceipt = null;
      for (const { receipt } of receipts) {
        const projected = schemaValue(schemaRegistry, 'failure-packet', {
          ...classified.packet,
          status: ACTION_STATUS[receipt.action]
        });
        if (
          !classified.envelope
          || !projected
          || receipt.root_failure_digest !== sha256(canonicalJson(root))
          || receipt.from_status !== current.status
          || receipt.to_status !== projected.status
          || receipt.projection_digest !== sha256(canonicalJson(projected))
          || idempotencyKeys.has(receipt.idempotency_key)
          || proposalIds.has(receipt.proposal_id)
        ) {
          blockers.push(blocker(
            'verification-failure-state:receipt-invalid',
            receipt.id
          ));
          latestReceipt = null;
          break;
        }
        idempotencyKeys.add(receipt.idempotency_key);
        proposalIds.add(receipt.proposal_id);
        current = projected;
        latestReceipt = receipt;
      }
      states.push({
        failure_id: root.id,
        root_failure_digest: sha256(canonicalJson(root)),
        classification_envelope_id: classified.envelope?.id || null,
        logical_status: current.status,
        transition_receipt_id: latestReceipt?.id || null
      });
      effectiveFailures.push(current);
    }
    for (const { failure, root } of followups) {
      states.push({
        failure_id: failure.id,
        root_failure_id: root.id,
        root_failure_digest: sha256(canonicalJson(root)),
        classification_envelope_id: null,
        logical_status: 'superseded',
        transition_receipt_id: null
      });
    }

    for (const envelope of request.classification_envelopes) {
      if (!rootIds.has(envelope?.bindings?.failure_id)) {
        blockers.push(blocker(
          'verification-failure-state:classification-orphaned',
          envelope?.id || 'classification-envelope'
        ));
      }
    }
    for (const { proposal } of proposalsById.values()) {
      if (!rootIds.has(proposal.failure_id)) {
        blockers.push(blocker(
          'verification-failure-state:proposal-orphaned',
          proposal.id
        ));
      }
    }
    for (const { receipt } of receiptEnvelopes) {
      if (!rootIds.has(receipt.failure_id)) {
        blockers.push(blocker(
          'verification-failure-state:receipt-orphaned',
          receipt.id
        ));
      }
    }

    const openFailureIds = states
      .filter((state) => (
        state.logical_status !== 'closed'
        && state.logical_status !== 'superseded'
      ))
      .map((state) => state.failure_id)
      .sort();
    return deepFreeze({
      ok: blockers.length === 0,
      states: states.sort((left, right) => (
        left.failure_id.localeCompare(right.failure_id)
      )),
      effective_failures: effectiveFailures.sort((left, right) => (
        left.id.localeCompare(right.id)
      )),
      open_failure_ids: openFailureIds,
      blockers
    });
  }

  return Object.freeze({ reduce });
}

module.exports = {
  ACTION_STATUS,
  createFailureStateReducer
};
