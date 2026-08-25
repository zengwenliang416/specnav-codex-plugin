'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const {
  validateRetryIdentityCore
} = require('../contracts/retry-identity-validator');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const REQUEST_FIELDS = Object.freeze([
  'classification_result',
  'runs',
  'attempts',
  'attempt_facts',
  'historical_artifact_loss',
  'repair_link',
  'repair_recovery',
  'repair_rebind',
  'rerun_plan'
]);
const CLASSIFICATION_RESULT_FIELDS = Object.freeze([
  'ok',
  'status',
  'packet',
  'signals',
  'blockers'
]);
const FACT_FIELDS = Object.freeze([
  'attempt_id',
  'case_id',
  'attempt_digest',
  'verdict',
  'evidence_ids',
  'integrity',
  'freshness',
  'recorded_at'
]);
const TRUSTED_PRODUCERS = Object.freeze({
  classification_result: 'specnav-failure-classifier',
  repair_link: 'specnav-development-repair-bridge',
  repair_recovery: 'specnav-repair-lineage-recovery',
  repair_rebind: 'specnav-repair-generation-rebind',
  historical_artifact_loss: 'specnav-historical-artifact-loss-recorder',
  attempt_fact: 'specnav-execution-evidence',
  rerun_plan: 'specnav-case-rerun-planner'
});
const REQUIRED_CLAIMS = Object.freeze({
  classification_result: Object.freeze([
    'failure-classification:verified'
  ]),
  repair_link: Object.freeze([
    'repair-review:spec-approved',
    'repair-review:quality-approved',
    'repair-evidence:verified'
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
  historical_artifact_loss: Object.freeze([
    'artifact-loss:human-approved',
    'artifact-loss:classification-bound',
    'artifact-loss:history-unrecoverable',
    'artifact-loss:no-integrity-claim'
  ]),
  attempt_fact: Object.freeze([
    'attempt-binding:verified',
    'evidence-integrity:verified'
  ]),
  rerun_plan: Object.freeze([
    'rerun-scope:approved-current',
    'rerun-scope:policy-complete'
  ])
});
const REPAIR_CLASSIFICATIONS = Object.freeze([
  'product_defect',
  'test_defect'
]);
const RETRY_CLASSIFICATIONS = Object.freeze([
  'environment_defect',
  'flaky'
]);
const PROPOSAL_TARGETS = Object.freeze({
  request_retry: 'retry',
  request_repair: 'development_repair',
  request_retest: 'retest',
  request_regression: 'regression',
  close_failure: 'closed',
  reopen_failure: 'reopened',
  route_break_loop: 'break_loop'
});
const FINGERPRINT_FIELDS = Object.freeze([
  'case_snapshot_hash',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentity(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim();
}

function validDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function exactFields(value, allowed) {
  return isRecord(value)
    && Object.keys(value).every((field) => allowed.includes(field));
}

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function stableBlockers(values) {
  const unique = new Map();
  for (const value of values) {
    const key = canonicalJson(value);
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ));
}

function blocked(values, history = []) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    label: 'blocked',
    history,
    transition_proposal: null,
    blockers: stableBlockers(values)
  });
}

function schemaValue(schemaRegistry, entityType, value) {
  try {
    const result = schemaRegistry.validate(entityType, value);
    return result?.ok === true ? result.value : null;
  } catch {
    return null;
  }
}

function sameFingerprint(attempt, fingerprint) {
  return FINGERPRINT_FIELDS.every((field) => (
    attempt[field] === fingerprint[field]
  ));
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function compareAttempts(left, right) {
  return left.sequence - right.sequence
    || String(left.completed_at || '').localeCompare(
      String(right.completed_at || '')
    )
    || String(left.started_at || '').localeCompare(
      String(right.started_at || '')
    )
    || left.id.localeCompare(right.id);
}

function orderedAttempts(values) {
  return [...values].sort(compareAttempts);
}

function isTrustedInitialFailure(packet, attempt, fact) {
  if (!attempt || !fact) return false;
  if (attempt.status === 'passed') {
    return fact.verdict === 'pass'
      && packet.reading_ids.length > 0
      && packet.failed_assertion_ids.length > 0;
  }
  if (attempt.status === 'blocked') return fact.verdict === 'blocked';
  if (attempt.status === 'failed') return fact.verdict === 'fail';
  return false;
}

function rerunScopeProjection(plan) {
  return {
    required_cases: sorted(plan.required_cases),
    baseline_cases: sorted(plan.baseline_cases),
    repaired_cases: sorted(plan.repaired_cases),
    impacted_cases: sorted(plan.impacted_cases),
    cases_to_rerun: [...plan.cases_to_rerun]
      .map((entry) => ({
        case_id: entry.case_id,
        reasons: sorted(entry.reasons)
      }))
      .sort((left, right) => left.case_id.localeCompare(right.case_id)),
    reasons_by_case: Object.fromEntries(
      Object.entries(plan.reasons_by_case)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([caseId, reasons]) => [caseId, sorted(reasons)])
    )
  };
}

function sameBindings(actual, expected) {
  return Object.entries(expected).every(([field, value]) => (
    actual[field] === value
  ));
}

function verifyEnvelope(
  schemaRegistry,
  trustVerifier,
  kind,
  rawEnvelope,
  expectedBindings = {}
) {
  const envelope = schemaValue(
    schemaRegistry,
    'trusted-fact-envelope',
    rawEnvelope
  );
  if (
    !envelope
    || envelope.kind !== kind
    || envelope.producer !== TRUSTED_PRODUCERS[kind]
    || sha256(canonicalJson(envelope.payload)) !== envelope.payload_digest
    || !sameBindings(envelope.bindings, expectedBindings)
    || REQUIRED_CLAIMS[kind].some((claim) => (
      !envelope.claims.includes(claim)
    ))
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:trusted-envelope-invalid',
        rawEnvelope?.id || kind
      )
    };
  }
  let verification;
  try {
    verification = trustVerifier.verify(envelope);
  } catch {
    verification = null;
  }
  if (
    !isRecord(verification)
    || verification.ok !== true
    || verification.envelope_id !== envelope.id
    || verification.payload_digest !== envelope.payload_digest
    || verification.producer !== envelope.producer
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:trusted-envelope-unverified',
        envelope.id
      )
    };
  }
  return { envelope, payload: envelope.payload };
}

function classificationState(envelope, schemaRegistry, trustVerifier) {
  const trusted = verifyEnvelope(
    schemaRegistry,
    trustVerifier,
    'classification_result',
    envelope
  );
  if (trusted.blocker) return trusted;
  const result = trusted.payload;
  if (
    !exactFields(result, CLASSIFICATION_RESULT_FIELDS)
    || result.ok !== true
    || result.status !== 'classified'
    || !Array.isArray(result.signals)
    || !Array.isArray(result.blockers)
    || result.blockers.length > 0
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:classification-result-invalid',
        'classification-result'
      )
    };
  }
  const packet = schemaValue(
    schemaRegistry,
    'failure-packet',
    result.packet
  );
  if (!packet || packet.classification === null) {
    return {
      blocker: blocker(
        'verification-repair-loop:failure-packet-invalid',
        result.packet?.id || 'failure-packet'
      )
    };
  }
  if (result.signals.length > 1) {
    return {
      blocker: blocker(
        'verification-repair-loop:break-loop-signal-invalid',
        packet.id
      )
    };
  }
  const signal = result.signals[0] || null;
  if (
    signal !== null
    && (
      !exactFields(signal, [
        'kind',
        'no_progress_count',
        'threshold',
        'failure_packet_id'
      ])
      || signal.kind !== 'break_loop_required'
      || !Number.isInteger(signal.no_progress_count)
      || !Number.isInteger(signal.threshold)
      || signal.threshold < 1
      || signal.no_progress_count < signal.threshold
      || signal.failure_packet_id !== packet.id
    )
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:break-loop-signal-invalid',
        packet.id
      )
    };
  }
  if (!sameBindings(trusted.envelope.bindings, {
    failure_id: packet.id,
    change_id: packet.change_id,
    run_id: packet.run_id,
    case_id: packet.case_id
  })) {
    return {
      blocker: blocker(
        'verification-repair-loop:classification-binding-mismatch',
        trusted.envelope.id
      )
    };
  }
  return { packet, signal, classificationEnvelope: trusted.envelope };
}

function validateHistoricalArtifactLoss(
  schemaRegistry,
  trustVerifier,
  packet,
  classificationEnvelope,
  rawEnvelope
) {
  const trusted = verifyEnvelope(
    schemaRegistry,
    trustVerifier,
    'historical_artifact_loss',
    rawEnvelope,
    {
      failure_id: packet.id,
      change_id: packet.change_id,
      run_id: packet.run_id,
      case_id: packet.case_id,
      attempt_id: packet.attempt_id
    }
  );
  if (trusted.blocker) return trusted;
  const artifactLoss = schemaValue(
    schemaRegistry,
    'historical-artifact-loss',
    trusted.payload
  );
  if (
    !artifactLoss
    || artifactLoss.failure_id !== packet.id
    || artifactLoss.change_id !== packet.change_id
    || artifactLoss.run_id !== packet.run_id
    || artifactLoss.case_id !== packet.case_id
    || artifactLoss.attempt_id !== packet.attempt_id
    || artifactLoss.classification !== packet.classification
    || artifactLoss.classification_envelope_digest
      !== sha256(canonicalJson(classificationEnvelope))
    || artifactLoss.status !== 'unrecoverable'
    || artifactLoss.permitted_transition !== 'route_break_loop'
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:historical-artifact-loss-invalid',
        rawEnvelope?.id || packet.id
      )
    };
  }
  return { artifactLoss, envelope: trusted.envelope };
}

function validateFacts(
  schemaRegistry,
  trustVerifier,
  packet,
  attempts,
  factEnvelopes
) {
  const blockers = [];
  if (!Array.isArray(factEnvelopes)) {
    return {
      blockers: [
        blocker(
          'verification-repair-loop:attempt-facts-invalid',
          'attempt-facts'
        )
      ],
      factsByAttempt: new Map()
    };
  }
  const attemptsById = new Map(attempts.map((attempt) => [
    attempt.id,
    attempt
  ]));
  const factsByAttempt = new Map();
  for (const rawEnvelope of factEnvelopes) {
    const boundAttemptId = rawEnvelope?.bindings?.attempt_id;
    const attempt = attemptsById.get(boundAttemptId);
    const trusted = verifyEnvelope(
      schemaRegistry,
      trustVerifier,
      'attempt_fact',
      rawEnvelope,
      {
        failure_id: packet.id,
        change_id: packet.change_id,
        run_id: attempt?.run_id,
        case_id: attempt?.case_id,
        attempt_id: attempt?.id
      }
    );
    if (trusted.blocker) {
      blockers.push(trusted.blocker);
      continue;
    }
    const fact = trusted.payload;
    if (
      !exactFields(fact, FACT_FIELDS)
      || !isIdentity(fact.attempt_id)
      || !isIdentity(fact.case_id)
      || typeof fact.attempt_digest !== 'string'
      || !/^[a-f0-9]{64}$/.test(fact.attempt_digest)
      || !['pass', 'fail', 'blocked'].includes(fact.verdict)
      || !Array.isArray(fact.evidence_ids)
      || fact.evidence_ids.length === 0
      || fact.evidence_ids.some((id) => !isIdentity(id))
      || new Set(fact.evidence_ids).size !== fact.evidence_ids.length
      || !['intact', 'invalid'].includes(fact.integrity)
      || !['fresh', 'stale'].includes(fact.freshness)
      || !validDate(fact.recorded_at)
    ) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-fact-invalid',
        fact?.attempt_id || 'attempt-fact'
      ));
      continue;
    }
    if (
      !attempt
      || attempt.case_id !== fact.case_id
      || fact.attempt_digest !== sha256(canonicalJson(attempt))
      || factsByAttempt.has(fact.attempt_id)
    ) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-fact-binding-mismatch',
        fact.attempt_id
      ));
      continue;
    }
    const expectedVerdict = attempt.status === 'passed'
      ? 'pass'
      : attempt.status === 'blocked'
        ? 'blocked'
        : attempt.status === 'failed'
          ? 'fail'
          : null;
    if (
      expectedVerdict === null
      || expectedVerdict !== fact.verdict
      || attempt.completed_at !== fact.recorded_at
    ) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-fact-status-mismatch',
        fact.attempt_id
      ));
      continue;
    }
    factsByAttempt.set(fact.attempt_id, deepFreeze(structuredClone(fact)));
  }
  for (const attempt of attempts) {
    if (factsByAttempt.has(attempt.id)) continue;
    blockers.push(blocker(
      'verification-repair-loop:attempt-fact-missing',
      attempt.id
    ));
  }
  return { blockers, factsByAttempt };
}

function validateRuns(schemaRegistry, packet, rawRuns, attempts) {
  if (!Array.isArray(rawRuns) || rawRuns.length === 0) {
    return {
      blockers: [blocker(
        'verification-repair-loop:run-history-missing',
        packet.id
      )],
      runsById: new Map()
    };
  }
  const blockers = [];
  const runsById = new Map();
  for (const rawRun of rawRuns) {
    const run = schemaValue(schemaRegistry, 'verification-run', rawRun);
    if (!run) {
      blockers.push(blocker(
        'verification-repair-loop:run-schema-invalid',
        rawRun?.id || 'verification-run'
      ));
      continue;
    }
    if (runsById.has(run.id)) {
      blockers.push(blocker(
        'verification-repair-loop:run-duplicate',
        run.id
      ));
      continue;
    }
    runsById.set(run.id, run);
  }
  const initialRun = runsById.get(packet.run_id);
  if (
    !initialRun
    || initialRun.change_id !== packet.change_id
    || initialRun.kind !== 'initial'
    || initialRun.origin_run_id !== null
    || initialRun.parent_run_id !== null
    || initialRun.parent_attempt_id !== null
    || initialRun.failure_id !== null
  ) {
    blockers.push(blocker(
      'verification-repair-loop:initial-run-binding-mismatch',
      packet.run_id
    ));
  }

  const attemptsById = new Map(attempts.map((attempt) => [
    attempt.id,
    attempt
  ]));
  for (const attempt of attempts) {
    const run = runsById.get(attempt.run_id);
    if (!run) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-run-missing',
        attempt.id
      ));
      continue;
    }
    if (
      attempt.change_id !== run.change_id
      || attempt.case_snapshot_hash !== run.case_snapshot_hash
      || attempt.code_sha !== run.code_sha
      || attempt.test_sha !== run.test_sha
      || attempt.environment_hash !== run.environment_hash
      || attempt.runtime_version !== run.runtime_version
      || attempt.kernel_version !== run.kernel_version
      || !run.case_ids.includes(attempt.case_id)
    ) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-run-identity-mismatch',
        attempt.id
      ));
      continue;
    }
    if (attempt.kind === 'initial' || attempt.kind === 'retry') {
      if (
        run.id !== packet.run_id
        || run.kind !== 'initial'
      ) {
        blockers.push(blocker(
          'verification-repair-loop:attempt-run-lineage-mismatch',
          attempt.id
        ));
      }
      continue;
    }
    const parentAttempt = attempt.parent_attempt_id
      ? attemptsById.get(attempt.parent_attempt_id)
      : null;
    if (
      run.kind !== attempt.kind
      || run.id === packet.run_id
      || run.origin_run_id !== packet.run_id
      || run.failure_id !== packet.id
      || !parentAttempt
      || run.parent_run_id !== parentAttempt.run_id
      || run.parent_attempt_id !== parentAttempt.id
    ) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-run-lineage-mismatch',
        attempt.id
      ));
    }
  }
  return { blockers, runsById };
}

function validateAttempts(
  schemaRegistry,
  trustVerifier,
  packet,
  rawRuns,
  rawAttempts,
  rawFacts
) {
  if (!Array.isArray(rawAttempts) || rawAttempts.length === 0) {
    return {
      blockers: [
        blocker(
          'verification-repair-loop:attempt-history-missing',
          packet.id
        )
      ],
      attempts: [],
      factsByAttempt: new Map()
    };
  }
  const blockers = [];
  const attempts = [];
  const ids = new Set();
  for (const rawAttempt of rawAttempts) {
    const attempt = schemaValue(schemaRegistry, 'attempt', rawAttempt);
    if (!attempt) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-schema-invalid',
        rawAttempt?.id || 'attempt'
      ));
      continue;
    }
    if (ids.has(attempt.id)) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-duplicate',
        attempt.id
      ));
    }
    ids.add(attempt.id);
    attempts.push(attempt);
    if (attempt.change_id !== packet.change_id) {
      blockers.push(blocker(
        'verification-repair-loop:attempt-context-mismatch',
        attempt.id
      ));
    }
  }

  const first = attempts.find((attempt) => attempt.id === packet.attempt_id);
  if (
    !first
    || (
      first.id !== packet.attempt_id
      || first.kind !== 'initial'
      || first.change_id !== packet.change_id
      || first.run_id !== packet.run_id
      || first.case_id !== packet.case_id
      || !['passed', 'failed', 'blocked'].includes(first.status)
    )
  ) {
    blockers.push(blocker(
      'verification-repair-loop:initial-attempt-binding-mismatch',
      first?.id || packet.attempt_id
    ));
  }

  const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  for (const attempt of attempts) {
    if (attempt.id === first?.id) continue;
    if (attempt.kind === 'initial') {
      blockers.push(blocker(
        'verification-repair-loop:initial-attempt-repeated',
        attempt.id
      ));
      continue;
    }
    if (
      attempt.parent_attempt_id
      && (
        !byId.has(attempt.parent_attempt_id)
        || attempt.sequence
          !== byId.get(attempt.parent_attempt_id).sequence + 1
      )
    ) {
      blockers.push(blocker(
        byId.has(attempt.parent_attempt_id)
          ? 'verification-repair-loop:attempt-sequence-invalid'
          : 'verification-repair-loop:attempt-parent-missing',
        attempt.id
      ));
    }
    if (attempt.kind === 'retry') {
      const retryResult = validateRetryIdentityCore(
        byId.get(attempt.parent_attempt_id),
        attempt
      );
      blockers.push(...retryResult.blockers);
    }
  }
  const runResult = validateRuns(
    schemaRegistry,
    packet,
    rawRuns,
    attempts
  );
  blockers.push(...runResult.blockers);

  const factResult = validateFacts(
    schemaRegistry,
    trustVerifier,
    packet,
    attempts,
    rawFacts
  );
  blockers.push(...factResult.blockers);
  const firstFact = first ? factResult.factsByAttempt.get(first.id) : null;
  if (firstFact && !isTrustedInitialFailure(packet, first, firstFact)) {
    blockers.push(blocker(
      'verification-repair-loop:initial-failure-fact-required',
      first.id
    ));
  }
  return {
    blockers,
    attempts: orderedAttempts(attempts),
    factsByAttempt: factResult.factsByAttempt
  };
}

function validateRepairLink(
  schemaRegistry,
  trustVerifier,
  packet,
  firstAttempt,
  rawEnvelope
) {
  const trusted = verifyEnvelope(
    schemaRegistry,
    trustVerifier,
    'repair_link',
    rawEnvelope,
    {
      failure_id: packet.id,
      change_id: packet.change_id,
      run_id: packet.run_id,
      case_id: packet.case_id
    }
  );
  if (trusted.blocker) return trusted;
  const link = schemaValue(schemaRegistry, 'repair-link', trusted.payload);
  if (!link) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-link-invalid',
        rawEnvelope?.id || 'repair-link'
      )
    };
  }
  const expectedKind = packet.classification === 'product_defect'
    ? 'product_code'
    : 'test_code';
  if (
    link.failure_id !== packet.id
    || link.change_id !== packet.change_id
    || link.repair_kind !== expectedKind
    || !sameFingerprint(firstAttempt, link.before_identity)
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-link-binding-mismatch',
        link.id
      )
    };
  }
  if (link.status !== 'completed') return { link };
  if (
    !link.after_identity
    || !validDate(link.completed_at)
    || !Array.isArray(link.review_evidence_ids)
    || link.review_evidence_ids.length < 2
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-completion-invalid',
        link.id
      )
    };
  }
  for (const field of [
    'case_snapshot_hash',
    'environment_hash',
    'runtime_version',
    'kernel_version'
  ]) {
    if (link.after_identity[field] === link.before_identity[field]) continue;
    return {
      blocker: blocker(
        'verification-repair-loop:repair-fingerprint-scope-invalid',
        link.id,
        field
      )
    };
  }
  const changedField = packet.classification === 'product_defect'
    ? 'code_sha'
    : 'test_sha';
  if (link.after_identity[changedField] === link.before_identity[changedField]) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-no-source-change',
        link.id,
        changedField
      )
    };
  }
  return { link };
}

function validateRepairRecovery(
  schemaRegistry,
  trustVerifier,
  packet,
  firstAttempt,
  rawEnvelope
) {
  const trusted = verifyEnvelope(
    schemaRegistry,
    trustVerifier,
    'repair_recovery',
    rawEnvelope,
    {
      failure_id: packet.id,
      change_id: packet.change_id,
      run_id: packet.run_id,
      case_id: packet.case_id
    }
  );
  if (trusted.blocker) return trusted;
  const recovery = schemaValue(
    schemaRegistry,
    'repair-lineage-recovery',
    trusted.payload
  );
  const link = recovery?.recovered_repair_link;
  const expectedKind = packet.classification === 'product_defect'
    ? 'product_code'
    : 'test_code';
  if (
    !recovery
    || recovery.failure_id !== packet.id
    || recovery.change_id !== packet.change_id
    || recovery.classification !== packet.classification
    || recovery.decision !== 'approved'
    || recovery.reviewer?.kind !== 'human'
    || !validDate(recovery.reviewed_at)
    || !link
    || link.failure_id !== packet.id
    || link.change_id !== packet.change_id
    || link.repair_kind !== expectedKind
    || link.status !== 'completed'
    || !sameFingerprint(firstAttempt, link.before_identity)
    || !link.after_identity
    || !validDate(link.completed_at)
    || !Array.isArray(link.review_evidence_ids)
    || link.review_evidence_ids.length < 2
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-recovery-invalid',
        rawEnvelope?.id || 'repair-recovery'
      )
    };
  }
  const protectedDrift = [
    'case_snapshot_hash',
    'environment_hash',
    'runtime_version',
    'kernel_version'
  ].filter((field) => (
    link.after_identity[field] !== link.before_identity[field]
  ));
  if (
    canonicalJson(sorted(protectedDrift))
      !== canonicalJson(sorted(recovery.allowed_identity_drift))
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-recovery-drift-invalid',
        recovery.id,
        protectedDrift.join(',')
      )
    };
  }
  const changedField = packet.classification === 'product_defect'
    ? 'code_sha'
    : 'test_sha';
  if (link.after_identity[changedField] === link.before_identity[changedField]) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-no-source-change',
        link.id,
        changedField
      )
    };
  }
  return { link, recovery };
}

function validateRepairRebind(
  schemaRegistry,
  trustVerifier,
  packet,
  firstAttempt,
  rawEnvelope
) {
  const trusted = verifyEnvelope(
    schemaRegistry,
    trustVerifier,
    'repair_rebind',
    rawEnvelope,
    {
      failure_id: packet.id,
      change_id: packet.change_id,
      run_id: packet.run_id,
      case_id: packet.case_id
    }
  );
  if (trusted.blocker) return trusted;
  const rebind = schemaValue(
    schemaRegistry,
    'repair-generation-rebind',
    trusted.payload
  );
  const link = rebind?.rebound_repair_link;
  const previous = rebind?.previous_repair_link;
  const expectedKind = packet.classification === 'product_defect'
    ? 'product_code'
    : 'test_code';
  if (
    !rebind
    || rebind.failure_id !== packet.id
    || rebind.change_id !== packet.change_id
    || rebind.classification !== packet.classification
    || rebind.decision !== 'approved'
    || rebind.reviewer?.kind !== 'human'
    || !validDate(rebind.reviewed_at)
    || !previous
    || !link
    || rebind.previous_repair_link_digest
      !== sha256(canonicalJson(previous))
    || previous.failure_id !== packet.id
    || previous.status !== 'completed'
    || link.failure_id !== packet.id
    || link.change_id !== packet.change_id
    || link.repair_kind !== expectedKind
    || link.status !== 'completed'
    || !sameFingerprint(firstAttempt, link.before_identity)
    || !validDate(link.completed_at)
    || Date.parse(link.completed_at) < Date.parse(previous.completed_at)
    || !Array.isArray(link.review_evidence_ids)
    || link.review_evidence_ids.length < 2
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:repair-rebind-invalid',
        rawEnvelope?.id || 'repair-rebind'
      )
    };
  }
  return { link, rebind };
}

function validateRerunPlan(
  schemaRegistry,
  trustVerifier,
  rerunScopeAuthority,
  rawEnvelope,
  packet
) {
  if (!isRecord(rawEnvelope)) {
    return {
      blocker: blocker(
        'verification-repair-loop:rerun-plan-missing',
        'rerun-plan'
      )
    };
  }
  const trusted = verifyEnvelope(
    schemaRegistry,
    trustVerifier,
    'rerun_plan',
    rawEnvelope,
    {
      failure_id: packet.id,
      change_id: packet.change_id,
      run_id: packet.run_id,
      case_id: packet.case_id
    }
  );
  if (trusted.blocker) return trusted;
  const plan = trusted.payload;
  const failureCaseId = packet.case_id;
  const arrayFields = [
    'required_cases',
    'baseline_cases',
    'repaired_cases',
    'impacted_cases',
    'blockers'
  ];
  if (
    plan.ok !== true
    || arrayFields.some((field) => !Array.isArray(plan[field]))
    || !Array.isArray(plan.cases_to_rerun)
    || !isRecord(plan.reasons_by_case)
    || plan.blockers.length > 0
    || !plan.repaired_cases.includes(failureCaseId)
    || !plan.required_cases.includes(failureCaseId)
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:rerun-plan-invalid',
        'rerun-plan'
      )
    };
  }
  const ownedCases = sorted([
    ...plan.repaired_cases,
    ...plan.impacted_cases,
    ...plan.baseline_cases
  ]);
  const requiredCases = sorted(plan.required_cases);
  if (
    canonicalJson(ownedCases) !== canonicalJson(requiredCases)
    || requiredCases.some((caseId) => !isIdentity(caseId))
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:rerun-plan-coverage-invalid',
        'rerun-plan'
      )
    };
  }
  let authoritative;
  try {
    authoritative = rerunScopeAuthority.resolve({
      failure_id: packet.id,
      change_id: packet.change_id,
      run_id: packet.run_id,
      case_id: packet.case_id
    });
  } catch {
    authoritative = null;
  }
  if (
    !isRecord(authoritative)
    || authoritative.ok !== true
    || !isRecord(authoritative.scope)
    || typeof authoritative.scope_digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(authoritative.scope_digest)
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:rerun-scope-authority-unavailable',
        packet.id
      )
    };
  }
  let actualScope;
  let expectedScope;
  try {
    actualScope = rerunScopeProjection(plan);
    expectedScope = rerunScopeProjection(authoritative.scope);
  } catch {
    return {
      blocker: blocker(
        'verification-repair-loop:rerun-scope-authority-invalid',
        packet.id
      )
    };
  }
  if (
    authoritative.scope_digest !== sha256(canonicalJson(expectedScope))
    || canonicalJson(actualScope) !== canonicalJson(expectedScope)
  ) {
    return {
      blocker: blocker(
        'verification-repair-loop:rerun-scope-authority-mismatch',
        packet.id
      )
    };
  }
  return {
    requiredCases,
    regressionCases: requiredCases.filter((caseId) => (
      caseId !== failureCaseId
    )),
    scopeDigest: authoritative.scope_digest
  };
}

function attemptLabel(attempt, fact) {
  if (attempt.kind === 'retry' && fact.verdict === 'pass') return 'FLAKY';
  if (attempt.kind === 'retest' && fact.verdict === 'pass') {
    return 'PASS AFTER FIX';
  }
  if (fact.verdict === 'pass') return 'PASS';
  if (fact.verdict === 'blocked') return 'BLOCKED';
  return 'FAILED';
}

function buildHistory(attempts, factsByAttempt, repairLink) {
  const history = [];
  let repairInserted = false;
  for (const attempt of orderedAttempts(attempts)) {
    if (
      repairLink
      && !repairInserted
      && ['retest', 'regression'].includes(attempt.kind)
    ) {
      history.push({
        kind: 'repair',
        repair_link_id: repairLink.id,
        label: repairLink.status === 'completed'
          ? 'REPAIR COMPLETED'
          : 'REPAIR IN PROGRESS',
        recorded_at: repairLink.completed_at || repairLink.requested_at
      });
      repairInserted = true;
    }
    const fact = factsByAttempt.get(attempt.id);
    history.push({
      kind: attempt.kind,
      attempt_id: attempt.id,
      case_id: attempt.case_id,
      label: attemptLabel(attempt, fact),
      verdict: fact.verdict,
      integrity: fact.integrity,
      freshness: fact.freshness,
      evidence_ids: [...fact.evidence_ids],
      recorded_at: fact.recorded_at
    });
  }
  if (repairLink && !repairInserted) {
    history.push({
      kind: 'repair',
      repair_link_id: repairLink.id,
      label: repairLink.status === 'completed'
        ? 'REPAIR COMPLETED'
        : 'REPAIR IN PROGRESS',
      recorded_at: repairLink.completed_at || repairLink.requested_at
    });
  }
  return history;
}

function createRepairLoopStateMachine(options = {}) {
  const {
    schemaRegistry,
    trustVerifier,
    rerunScopeAuthority,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !trustVerifier
    || typeof trustVerifier.verify !== 'function'
    || !rerunScopeAuthority
    || typeof rerunScopeAuthority.resolve !== 'function'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-repair-loop:config-invalid');
  }

  function proposal({
    packet,
    action,
    fromState,
    caseIds,
    attempts,
    reasonIds,
    repairLink,
    scopeDigest
  }) {
    const proposedAt = [
      packet.frozen_at,
      packet.created_at,
      repairLink?.requested_at,
      repairLink?.completed_at,
      ...attempts.flatMap((attempt) => [
        attempt.started_at,
        attempt.completed_at
      ])
    ].filter(validDate).sort().at(-1);
    if (!validDate(proposedAt)) return null;
    const fields = {
      schema: 'specnav.verification.transition-proposal.v1',
      failure_id: packet.id,
      change_id: packet.change_id,
      action,
      owner: 'core',
      from_state: fromState,
      target_state: PROPOSAL_TARGETS[action],
      case_ids: sorted(caseIds),
      attempt_ids: sorted(attempts.map((attempt) => attempt.id)),
      reason_ids: sorted(reasonIds),
      ...(repairLink ? { repair_link_id: repairLink.id } : {}),
      ...(scopeDigest ? { scope_digest: scopeDigest } : {}),
      proposed_at: proposedAt
    };
    const candidate = {
      ...fields,
      id: `transition-${sha256(canonicalJson({
        ...fields,
        proposed_at: undefined
      }))}`
    };
    return schemaValue(
      schemaRegistry,
      'transition-proposal',
      candidate
    );
  }

  function result({
    packet,
    status,
    label,
    history,
    action,
    caseIds,
    attempts,
    reasonIds,
    repairLink,
    scopeDigest
  }) {
    const transitionProposal = proposal({
      packet,
      action,
      fromState: status,
      caseIds,
      attempts,
      reasonIds,
      repairLink,
      scopeDigest
    });
    if (!transitionProposal) {
      return blocked([
        blocker(
          'verification-repair-loop:transition-proposal-invalid',
          packet.id
        )
      ], history);
    }
    return deepFreeze({
      ok: true,
      status,
      label,
      history,
      transition_proposal: transitionProposal,
      blockers: []
    });
  }

  function evaluate(request) {
    if (!exactFields(request, REQUEST_FIELDS)) {
      return blocked([
        blocker(
          'verification-repair-loop:request-field-unknown',
          'repair-loop-request'
        )
      ]);
    }
    const classification = classificationState(
      request.classification_result,
      schemaRegistry,
      trustVerifier
    );
    if (classification.blocker) return blocked([classification.blocker]);
    const {
      packet,
      signal,
      classificationEnvelope
    } = classification;
    if (request.historical_artifact_loss !== undefined) {
      const conflictingAuthority = [
        request.repair_link,
        request.repair_recovery,
        request.repair_rebind,
        request.rerun_plan
      ].some((entry) => entry !== undefined);
      if (
        signal !== null
        || conflictingAuthority
        || !Array.isArray(request.runs)
        || request.runs.length > 0
        || !Array.isArray(request.attempts)
        || request.attempts.length > 0
        || !Array.isArray(request.attempt_facts)
        || request.attempt_facts.length > 0
      ) {
        return blocked([
          blocker(
            'verification-repair-loop:historical-artifact-loss-authority-ambiguous',
            packet.id
          )
        ]);
      }
      const artifactLossState = validateHistoricalArtifactLoss(
        schemaRegistry,
        trustVerifier,
        packet,
        classificationEnvelope,
        request.historical_artifact_loss
      );
      if (artifactLossState.blocker) {
        return blocked([artifactLossState.blocker]);
      }
      return result({
        packet,
        status: 'break_loop_required',
        label: 'blocked',
        history: [],
        action: 'route_break_loop',
        caseIds: [packet.case_id],
        attempts: [],
        reasonIds: [
          'historical-artifact-loss:unrecoverable',
          `historical-artifact-loss:${artifactLossState.artifactLoss.id}`,
          `historical-artifact-loss-review:${artifactLossState.artifactLoss.review_id}`
        ]
      });
    }
    const attemptState = validateAttempts(
      schemaRegistry,
      trustVerifier,
      packet,
      request.runs,
      request.attempts,
      request.attempt_facts
    );
    if (attemptState.blockers.length > 0) {
      return blocked(attemptState.blockers);
    }
    const { attempts, factsByAttempt } = attemptState;
    const first = attempts.find((attempt) => attempt.id === packet.attempt_id);

    let repairLink = null;
    if (
      [
        request.repair_link,
        request.repair_recovery,
        request.repair_rebind
      ].filter((entry) => entry !== undefined).length > 1
    ) {
      return blocked([
        blocker(
          'verification-repair-loop:repair-authority-ambiguous',
          packet.id
        )
      ]);
    }
    if (request.repair_link !== undefined) {
      const repair = validateRepairLink(
        schemaRegistry,
        trustVerifier,
        packet,
        first,
        request.repair_link
      );
      if (repair.blocker) return blocked([repair.blocker]);
      repairLink = repair.link;
    }
    if (request.repair_recovery !== undefined) {
      const recovery = validateRepairRecovery(
        schemaRegistry,
        trustVerifier,
        packet,
        first,
        request.repair_recovery
      );
      if (recovery.blocker) return blocked([recovery.blocker]);
      repairLink = recovery.link;
    }
    if (request.repair_rebind !== undefined) {
      const rebind = validateRepairRebind(
        schemaRegistry,
        trustVerifier,
        packet,
        first,
        request.repair_rebind
      );
      if (rebind.blocker) return blocked([rebind.blocker]);
      repairLink = rebind.link;
    }
    const history = buildHistory(attempts, factsByAttempt, repairLink);

    if (signal) {
      return result({
        packet,
        status: 'break_loop_required',
        label: 'blocked',
        history,
        action: 'route_break_loop',
        caseIds: [packet.case_id],
        attempts,
        reasonIds: [
          `no-progress-threshold:${signal.threshold}`,
          `no-progress-count:${signal.no_progress_count}`
        ],
        repairLink
      });
    }

    const retries = orderedAttempts(
      attempts.filter((attempt) => attempt.kind === 'retry')
    );
    const retests = orderedAttempts(
      attempts.filter((attempt) => attempt.kind === 'retest')
    );
    const regressions = orderedAttempts(attempts.filter((attempt) => (
      attempt.kind === 'regression'
    )));

    if (REPAIR_CLASSIFICATIONS.includes(packet.classification)) {
      if (retries.length > 0) {
        return blocked([
          blocker(
            'verification-repair-loop:retry-not-eligible',
            retries[0].id
          )
        ], history);
      }
      if (!repairLink) {
        return result({
          packet,
          status: 'repair_required',
          label: 'failed',
          history,
          action: 'request_repair',
          caseIds: [packet.case_id],
          attempts,
          reasonIds: ['classified-repair-required']
        });
      }
      if (repairLink.status !== 'completed') {
        return deepFreeze({
          ok: true,
          status: 'repair_in_progress',
          label: 'failed',
          history,
          transition_proposal: null,
          blockers: []
        });
      }
      const repairCompletedAt = Date.parse(repairLink.completed_at);
      const currentRetests = retests.filter((attempt) => (
        Date.parse(attempt.started_at) >= repairCompletedAt
      ));
      const currentRegressions = regressions.filter((attempt) => (
        Date.parse(attempt.started_at) >= repairCompletedAt
      ));
      if (currentRetests.length === 0) {
        return result({
          packet,
          status: 'retest_required',
          label: 'failed',
          history,
          action: 'request_retest',
          caseIds: [packet.case_id],
          attempts,
          reasonIds: ['reviewed-repair-completed'],
          repairLink
        });
      }

      for (const retest of currentRetests) {
        if (
          retest.case_id !== packet.case_id
          || !sameFingerprint(retest, repairLink.after_identity)
          || !retest.parent_attempt_id
          || !attempts.some((attempt) => (
            attempt.id === retest.parent_attempt_id
            && attempt.sequence < retest.sequence
          ))
        ) {
          return blocked([
            blocker(
              'verification-repair-loop:retest-binding-mismatch',
              retest.id
            )
          ], history);
        }
      }
      const latestRetest = currentRetests.at(-1);
      const retestFact = factsByAttempt.get(latestRetest.id);
      if (
        retestFact.verdict !== 'pass'
        || retestFact.integrity !== 'intact'
        || retestFact.freshness !== 'fresh'
      ) {
        return result({
          packet,
          status: 'reopen_required',
          label: 'failed',
          history,
          action: 'reopen_failure',
          caseIds: [packet.case_id],
          attempts,
          reasonIds: ['retest-not-fresh-pass'],
          repairLink
        });
      }

      const rerun = validateRerunPlan(
        schemaRegistry,
        trustVerifier,
        rerunScopeAuthority,
        request.rerun_plan,
        packet
      );
      if (rerun.blocker) return blocked([rerun.blocker], history);
      const latestRegressionByCase = new Map();
      for (const regression of currentRegressions) {
        if (
          regression.sequence <= latestRetest.sequence
          || !sameFingerprint(regression, repairLink.after_identity)
          || !rerun.regressionCases.includes(regression.case_id)
        ) {
          return blocked([
            blocker(
              'verification-repair-loop:regression-binding-mismatch',
              regression.id
            )
          ], history);
        }
        const prior = latestRegressionByCase.get(regression.case_id);
        if (!prior || compareAttempts(prior, regression) < 0) {
          latestRegressionByCase.set(regression.case_id, regression);
        }
      }
      const missingCases = rerun.regressionCases.filter((caseId) => (
        !latestRegressionByCase.has(caseId)
      ));
      if (missingCases.length > 0) {
        return result({
          packet,
          status: 'regression_required',
          label: 'pass_after_fix',
          history,
          action: 'request_regression',
          caseIds: missingCases,
          attempts,
          reasonIds: missingCases.map((caseId) => (
            `required-regression-missing:${caseId}`
          )),
          repairLink,
          scopeDigest: rerun.scopeDigest
        });
      }
      const failedCases = [];
      for (const caseId of rerun.regressionCases) {
        const regression = latestRegressionByCase.get(caseId);
        const fact = factsByAttempt.get(regression.id);
        if (
          fact.verdict !== 'pass'
          || fact.integrity !== 'intact'
          || fact.freshness !== 'fresh'
        ) {
          failedCases.push(caseId);
        }
      }
      if (failedCases.length > 0) {
        return result({
          packet,
          status: 'reopen_required',
          label: 'pass_after_fix',
          history,
          action: 'reopen_failure',
          caseIds: failedCases,
          attempts,
          reasonIds: failedCases.map((caseId) => (
            `required-regression-not-fresh-pass:${caseId}`
          )),
          repairLink,
          scopeDigest: rerun.scopeDigest
        });
      }
      return result({
        packet,
        status: 'closure_ready',
        label: 'pass_after_fix',
        history,
        action: 'close_failure',
        caseIds: rerun.requiredCases,
        attempts,
        reasonIds: ['required-regression-passed'],
        repairLink,
        scopeDigest: rerun.scopeDigest
      });
    }

    if (RETRY_CLASSIFICATIONS.includes(packet.classification)) {
      if (repairLink || retests.length > 0 || regressions.length > 0) {
        return blocked([
          blocker(
            'verification-repair-loop:repair-not-eligible',
            packet.id
          )
        ], history);
      }
      if (retries.length === 0) {
        return result({
          packet,
          status: 'retry_required',
          label: 'failed',
          history,
          action: 'request_retry',
          caseIds: [packet.case_id],
          attempts,
          reasonIds: ['classified-retry-allowed']
        });
      }
      const latestRetry = retries.at(-1);
      const latestFact = factsByAttempt.get(latestRetry.id);
      if (
        latestFact.verdict === 'pass'
        && latestFact.integrity === 'intact'
        && latestFact.freshness === 'fresh'
      ) {
        return result({
          packet,
          status: 'closure_ready',
          label: 'flaky',
          history,
          action: 'close_failure',
          caseIds: [packet.case_id],
          attempts,
          reasonIds: ['unchanged-fingerprint-retry-passed']
        });
      }
      return result({
        packet,
        status: 'reopen_required',
        label: 'failed',
        history,
        action: 'reopen_failure',
        caseIds: [packet.case_id],
        attempts,
        reasonIds: ['retry-not-fresh-pass']
      });
    }

    return deepFreeze({
      ok: true,
      status: 'classified',
      label: 'blocked',
      history,
      transition_proposal: null,
      blockers: []
    });
  }

  return Object.freeze({ evaluate });
}

module.exports = {
  PROPOSAL_TARGETS,
  createRepairLoopStateMachine
};
