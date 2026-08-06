'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const { canonicalJson, sha256 } = require('../evidence/identity');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function blocker(id, artifact = null, detail = null) {
  return { id, artifact, detail };
}

function stableBlockers(values) {
  const unique = new Map();
  for (const value of values) {
    const normalized = {
      id: value.id,
      artifact: value.artifact ?? null,
      detail: value.detail === null || value.detail === undefined
        ? null
        : typeof value.detail === 'string'
          ? value.detail
          : canonicalJson(value.detail)
    };
    const key = canonicalJson(normalized);
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ));
}

function stableIds(values) {
  return [...new Set(values)].sort();
}

function gateSemantic(gate) {
  return {
    change_id: gate.change_id,
    stage: gate.stage,
    decision: gate.decision,
    source_case_ids: stableIds(gate.source_case_ids || []),
    source_reading_ids: stableIds(gate.source_reading_ids || []),
    failure_state_status: gate.failure_state_status,
    failure_state_digest: gate.failure_state_digest,
    authority_chain_digest: gate.authority_chain_digest,
    evidence_index_version: gate.evidence_index_version,
    runtime_version: gate.runtime_version,
    kernel_version: gate.kernel_version,
    freshness: gate.freshness,
    integrity_status: gate.integrity_status,
    policy_version: gate.policy_version,
    blockers: stableBlockers(gate.blockers || []),
    warnings: stableBlockers(gate.warnings || [])
  };
}

function validateGateDecisionIdentity(gate) {
  if (!isRecord(gate) || typeof gate.id !== 'string') {
    return deepFreeze({
      ok: false,
      blockers: [blocker(
        'verification-gate:identity-invalid',
        gate?.id || 'gate-decision',
        'gate-shape-invalid'
      )]
    });
  }
  const expectedId = `gate-${sha256(canonicalJson(gateSemantic(gate)))}`;
  if (gate.id !== expectedId) {
    return deepFreeze({
      ok: false,
      blockers: [blocker(
        'verification-gate:identity-mismatch',
        gate.id,
        expectedId
      )]
    });
  }
  return deepFreeze({
    ok: true,
    expected_id: expectedId,
    blockers: []
  });
}

function invalidResult(detail) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    gate: null,
    blockers: [blocker(
      'verification-gate:request-invalid',
      'gate-request',
      detail
    )]
  });
}

function createDecisionEngine(options = {}) {
  const {
    schemaRegistry,
    aggregator,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !aggregator
    || typeof aggregator.aggregate !== 'function'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-gate:config-invalid');
  }

  function decide(request) {
    let input;
    try {
      input = structuredClone(request);
    } catch {
      return invalidResult('request-unreadable');
    }
    if (
      !isRecord(input)
      || !isRecord(input.aggregation_request)
      || !Array.isArray(input.open_failure_ids)
      || !['valid', 'invalid'].includes(input.failure_state_status)
      || !/^[a-f0-9]{64}$/.test(input.failure_state_digest || '')
      || !/^[a-f0-9]{64}$/.test(input.authority_chain_digest || '')
      || !isRecord(input.freshness)
    ) {
      return invalidResult('request-shape-invalid');
    }
    const decidedAt = clock();
    if (
      typeof decidedAt !== 'string'
      || Number.isNaN(Date.parse(decidedAt))
    ) {
      return invalidResult('clock-invalid');
    }

    const blockers = [];
    const aggregation = aggregator.aggregate(input.aggregation_request);
    if (aggregation.change_id !== input.change_id) {
      blockers.push(blocker(
        'verification-gate:aggregation-change-mismatch',
        aggregation.id || 'aggregation'
      ));
    }
    if (
      aggregation.ok !== true
      || aggregation.status !== 'pass'
    ) {
      blockers.push(blocker(
        'verification-gate:aggregate-not-pass',
        aggregation.id || 'aggregation',
        aggregation.status || 'unknown'
      ));
    }
    blockers.push(...(Array.isArray(aggregation.blockers)
      ? aggregation.blockers
      : []));
    if (input.freshness.status !== 'fresh') {
      blockers.push(blocker(
        'verification-gate:freshness-not-fresh',
        'freshness',
        input.freshness.status || 'unknown'
      ));
    }
    if (input.integrity_status !== 'intact') {
      blockers.push(blocker(
        'verification-gate:integrity-not-intact',
        'evidence-index',
        input.integrity_status || 'unknown'
      ));
    }
    for (const failureId of stableIds(input.open_failure_ids)) {
      blockers.push(blocker(
        'verification-gate:open-failure',
        failureId
      ));
    }
    if (input.failure_state_status !== 'valid') {
      blockers.push(blocker(
        'verification-gate:failure-state-invalid',
        input.failure_state_digest,
        input.authority_chain_digest
      ));
    }

    const gateBlockers = stableBlockers(blockers);
    const semantic = gateSemantic({
      change_id: input.change_id,
      stage: input.stage,
      decision: gateBlockers.length === 0 ? 'pass' : 'block',
      source_case_ids: aggregation.source_case_ids,
      source_reading_ids: aggregation.source_reading_ids,
      failure_state_status: input.failure_state_status,
      failure_state_digest: input.failure_state_digest,
      authority_chain_digest: input.authority_chain_digest,
      evidence_index_version: input.evidence_index_version,
      runtime_version: input.runtime_version,
      kernel_version: input.kernel_version,
      freshness: input.freshness,
      integrity_status: input.integrity_status,
      policy_version: input.policy_version,
      blockers: gateBlockers,
      warnings: []
    });
    const gate = {
      schema: 'specnav.verification.gate-decision.v1',
      id: `gate-${sha256(canonicalJson(semantic))}`,
      ...semantic,
      decided_at: decidedAt
    };
    const validation = schemaRegistry.validate('gate-decision', gate);
    if (!validation.ok) {
      return deepFreeze({
        ok: false,
        status: 'blocked',
        gate: null,
        blockers: stableBlockers([
          blocker(
            'verification-gate:schema-invalid',
            gate.id,
            validation.blockers
          )
        ])
      });
    }
    const frozenGate = validation.value;
    return deepFreeze({
      ok: frozenGate.decision === 'pass',
      status: frozenGate.decision === 'pass' ? 'pass' : 'blocked',
      gate: frozenGate,
      blockers: frozenGate.blockers
    });
  }

  return Object.freeze({ decide });
}

module.exports = {
  createDecisionEngine,
  validateGateDecisionIdentity
};
