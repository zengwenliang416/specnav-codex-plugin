'use strict';

const crypto = require('node:crypto');

const { deepFreeze } = require('../contracts/schema-registry');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const PRODUCERS = Object.freeze({
  classification_result: 'specnav-failure-classifier',
  repair_link: 'specnav-development-repair-bridge',
  repair_baseline: 'specnav-repair-baseline-recorder',
  repair_recovery: 'specnav-repair-lineage-recovery',
  repair_rebind: 'specnav-repair-generation-rebind',
  attempt_fact: 'specnav-execution-evidence',
  host_execution: 'specnav-managed-host-proof-runner',
  rerun_plan: 'specnav-case-rerun-planner',
  transition_proposal: 'specnav-repair-state-machine',
  transition_application: 'specnav-core-transition-applier'
});

const CLAIMS = Object.freeze({
  classification_result: Object.freeze([
    'failure-classification:verified'
  ]),
  repair_link: Object.freeze([
    'repair-review:spec-approved',
    'repair-review:quality-approved',
    'repair-evidence:verified'
  ]),
  repair_baseline: Object.freeze([
    'repair-baseline:identity-bound',
    'repair-baseline:git-revision-bound'
  ]),
  repair_recovery: Object.freeze([
    'repair-recovery:human-approved',
    'repair-recovery:invalid-lineage-preserved',
    'repair-recovery:scope-verified'
  ]),
  repair_rebind: Object.freeze([
    'repair-rebind:human-approved',
    'repair-rebind:previous-generation-preserved',
    'repair-rebind:scope-verified'
  ]),
  attempt_fact: Object.freeze([
    'attempt-binding:verified',
    'evidence-integrity:verified'
  ]),
  host_execution: Object.freeze([
    'host-execution:managed-runtime-authorized',
    'host-execution:command-results-bound',
    'host-execution:source-and-gates-bound'
  ]),
  rerun_plan: Object.freeze([
    'rerun-scope:approved-current',
    'rerun-scope:policy-complete'
  ]),
  transition_proposal: Object.freeze([
    'transition-proposal:kernel-derived',
    'transition-proposal:core-owned'
  ]),
  transition_application: Object.freeze([
    'transition-application:approved',
    'transition-application:proposal-bound'
  ])
});

function validDate(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function keyBytes(value) {
  const bytes = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : null;
  return bytes && bytes.length >= 32 ? bytes : null;
}

function signature(key, envelope) {
  const unsigned = structuredClone(envelope);
  delete unsigned.signature;
  return crypto.createHmac('sha256', key)
    .update(canonicalJson(unsigned))
    .digest('hex');
}

function sameStringSet(left, right) {
  const leftValues = [...left].sort();
  const rightValues = [...right].sort();
  return left.length === right.length
    && leftValues.every((value, index) => (
      value === rightValues[index]
    ));
}

function sameBindings(payload, bindings) {
  const failureId = payload.failure_id || payload.id;
  return failureId === bindings.failure_id
    && payload.change_id === bindings.change_id
    && (
      bindings.run_id === undefined
      || payload.run_id === undefined
      || payload.run_id === bindings.run_id
    )
    && (
      bindings.case_id === undefined
      || payload.case_id === undefined
      || payload.case_id === bindings.case_id
    )
    && (
      bindings.attempt_id === undefined
      || payload.attempt_id === undefined
      || payload.attempt_id === bindings.attempt_id
    );
}

function payloadValid(schemaRegistry, kind, payload, bindings) {
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || !bindings
    || typeof bindings !== 'object'
    || Array.isArray(bindings)
  ) return false;
  if (kind === 'classification_result') {
    const packet = schemaRegistry.validate(
      'failure-packet',
      payload.packet
    );
    return payload.ok === true
      && packet.ok
      && packet.value.classification !== null
      && sameBindings(packet.value, bindings);
  }
  if (kind === 'repair_link') {
    const link = schemaRegistry.validate('repair-link', payload);
    return link.ok && sameBindings(link.value, bindings);
  }
  if (kind === 'repair_baseline') {
    const baseline = schemaRegistry.validate('repair-baseline', payload);
    return baseline.ok && sameBindings(baseline.value, bindings);
  }
  if (kind === 'repair_recovery') {
    const recovery = schemaRegistry.validate(
      'repair-lineage-recovery',
      payload
    );
    return recovery.ok && sameBindings(recovery.value, bindings);
  }
  if (kind === 'repair_rebind') {
    const rebind = schemaRegistry.validate(
      'repair-generation-rebind',
      payload
    );
    return rebind.ok && sameBindings(rebind.value, bindings);
  }
  if (kind === 'attempt_fact') {
    return typeof payload.attempt_id === 'string'
      && typeof payload.case_id === 'string'
      && /^[a-f0-9]{64}$/.test(payload.attempt_digest)
      && ['pass', 'fail', 'blocked'].includes(payload.verdict)
      && Array.isArray(payload.evidence_ids)
      && ['intact', 'invalid'].includes(payload.integrity)
      && ['fresh', 'stale'].includes(payload.freshness)
      && validDate(payload.recorded_at)
      && payload.attempt_id === bindings.attempt_id
      && payload.case_id === bindings.case_id;
  }
  if (kind === 'host_execution') {
    const execution = schemaRegistry.validate('host-execution', payload);
    return execution.ok
      && execution.value.change_id === bindings.change_id
      && execution.value.run_id === bindings.run_id
      && execution.value.host === bindings.case_id
      && bindings.failure_id === execution.value.run_id;
  }
  if (kind === 'rerun_plan') {
    return payload.ok === true
      && Array.isArray(payload.required_cases)
      && Array.isArray(payload.baseline_cases)
      && Array.isArray(payload.repaired_cases)
      && Array.isArray(payload.impacted_cases)
      && Array.isArray(payload.cases_to_rerun)
      && payload.change === bindings.change_id;
  }
  if (kind === 'transition_proposal') {
    const proposal = schemaRegistry.validate(
      'transition-proposal',
      payload
    );
    return proposal.ok && sameBindings(proposal.value, bindings);
  }
  if (kind === 'transition_application') {
    const application = schemaRegistry.validate(
      'transition-application',
      payload
    );
    return application.ok && sameBindings(application.value, bindings);
  }
  return false;
}

function createTrustedFactAuthority(options = {}) {
  const {
    schemaRegistry,
    key,
    clock = () => new Date().toISOString()
  } = options;
  const authorityKey = keyBytes(key);
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !authorityKey
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-trust-authority:config-invalid');
  }

  function seal(kind, payload, bindings) {
    if (!Object.hasOwn(PRODUCERS, kind)) {
      throw new Error(`verification-trust-authority:kind-invalid:${kind}`);
    }
    const issuedAt = clock();
    if (!validDate(issuedAt)) {
      throw new Error('verification-trust-authority:clock-invalid');
    }
    const payloadClone = structuredClone(payload);
    const bindingClone = structuredClone(bindings);
    if (!payloadValid(
      schemaRegistry,
      kind,
      payloadClone,
      bindingClone
    )) {
      throw new Error(
        `verification-trust-authority:payload-invalid:${kind}`
      );
    }
    const payloadDigest = sha256(canonicalJson(payloadClone));
    const unsigned = {
      schema: 'specnav.verification.trusted-fact-envelope.v1',
      id: `trusted-fact-${sha256(canonicalJson({
        kind,
        payload_digest: payloadDigest,
        bindings: bindingClone
      }))}`,
      kind,
      producer: PRODUCERS[kind],
      payload: payloadClone,
      payload_digest: payloadDigest,
      issued_at: issuedAt,
      bindings: bindingClone,
      claims: [...CLAIMS[kind]],
      signature_algorithm: 'hmac-sha256'
    };
    const candidate = {
      ...unsigned,
      signature: signature(authorityKey, unsigned)
    };
    const result = schemaRegistry.validate('trusted-fact-envelope', candidate);
    if (!result.ok) {
      const error = new Error('verification-trust-authority:envelope-invalid');
      error.blockers = result.blockers;
      throw error;
    }
    return result.value;
  }

  function verify(rawEnvelope) {
    const result = schemaRegistry.validate(
      'trusted-fact-envelope',
      rawEnvelope
    );
    if (!result.ok) return { ok: false };
    const envelope = result.value;
    if (
      !Object.hasOwn(PRODUCERS, envelope.kind)
      || envelope.producer !== PRODUCERS[envelope.kind]
      || !sameStringSet(envelope.claims, CLAIMS[envelope.kind])
      || sha256(canonicalJson(envelope.payload)) !== envelope.payload_digest
      || !payloadValid(
        schemaRegistry,
        envelope.kind,
        envelope.payload,
        envelope.bindings
      )
    ) {
      return { ok: false };
    }
    const actual = Buffer.from(envelope.signature, 'hex');
    const expected = Buffer.from(
      signature(authorityKey, envelope),
      'hex'
    );
    if (
      actual.length !== expected.length
      || !crypto.timingSafeEqual(actual, expected)
    ) {
      return { ok: false };
    }
    return deepFreeze({
      ok: true,
      envelope_id: envelope.id,
      payload_digest: envelope.payload_digest,
      producer: envelope.producer
    });
  }

  function sealChainAnchor(payload) {
    const anchoredAt = payload?.anchored_at || clock();
    const unsignedFields = {
      schema: 'specnav.verification.authority-chain-anchor.v1',
      change_id: payload?.change_id,
      logs: structuredClone(payload?.logs),
      anchored_at: anchoredAt
    };
    const candidate = {
      ...unsignedFields,
      id: `authority-chain-anchor-${sha256(canonicalJson(
        unsignedFields
      ))}`,
      signature_algorithm: 'hmac-sha256'
    };
    const signed = {
      ...candidate,
      signature: signature(authorityKey, candidate)
    };
    const result = schemaRegistry.validate(
      'authority-chain-anchor',
      signed
    );
    if (!result.ok) {
      const error = new Error(
        'verification-trust-authority:chain-anchor-invalid'
      );
      error.blockers = result.blockers;
      throw error;
    }
    return result.value;
  }

  function verifyChainAnchor(rawAnchor) {
    const result = schemaRegistry.validate(
      'authority-chain-anchor',
      rawAnchor
    );
    if (!result.ok) return { ok: false };
    const anchor = result.value;
    const unsigned = structuredClone(anchor);
    delete unsigned.signature;
    const semantic = {
      schema: anchor.schema,
      change_id: anchor.change_id,
      logs: anchor.logs,
      anchored_at: anchor.anchored_at
    };
    const expectedId = `authority-chain-anchor-${sha256(canonicalJson(
      semantic
    ))}`;
    const actual = Buffer.from(anchor.signature, 'hex');
    const expected = Buffer.from(
      signature(authorityKey, unsigned),
      'hex'
    );
    if (
      anchor.id !== expectedId
      || actual.length !== expected.length
      || !crypto.timingSafeEqual(actual, expected)
    ) {
      return { ok: false };
    }
    return deepFreeze({ ok: true, anchor });
  }

  return Object.freeze({
    seal,
    sealChainAnchor,
    verify,
    verifyChainAnchor
  });
}

module.exports = {
  CLAIMS,
  PRODUCERS,
  createTrustedFactAuthority
};
