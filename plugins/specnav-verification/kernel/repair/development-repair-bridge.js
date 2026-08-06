'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const STANDARD_PACKET_ARTIFACTS = Object.freeze([
  'brief.md',
  'context.json',
  'report.md',
  'spec-review.md',
  'quality-review.md'
]);
const STANDARD_REVIEWS = Object.freeze([
  'spec-review',
  'quality-review'
]);
const OWNERSHIP = deepFreeze({
  evidence: 'verification',
  closure: 'verification',
  repair: 'development',
  reviews: 'development',
  transitions: 'core',
  break_loop: 'core'
});
const REPAIR_KIND = Object.freeze({
  product_defect: 'product_code',
  test_defect: 'test_code'
});
const IDENTITY_FIELDS = Object.freeze([
  'change_id',
  'run_id',
  'case_id',
  'attempt_id'
]);
const FINGERPRINT_FIELDS = Object.freeze([
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]);
const REQUEST_FIELDS = new Set([
  'attempt',
  'before_identity',
  'evidence',
  'failure_packet',
  'fallback_used',
  'manual_green',
  'scope_lock',
  'signals',
  'verification_mode'
]);
const BREAK_LOOP_FIELDS = new Set([
  'break_loop',
  'break_loop_required',
  'break_loop_signal',
  'lifecycle_transition'
]);
const COMPLETION_REVIEW_KINDS = Object.freeze([
  'spec-review',
  'quality-review'
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

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function blocked(value) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    development_task: null,
    repair_link: null,
    forwarded_signals: [],
    blockers: [value]
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

function sameIdentity(left, right) {
  return IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}

function attemptMatchesPacket(attempt, packet) {
  return attempt.change_id === packet.change_id
    && attempt.run_id === packet.run_id
    && attempt.case_id === packet.case_id
    && attempt.id === packet.attempt_id;
}

function evidenceMatchesAttempt(evidence, attempt) {
  return evidence.change_id === attempt.change_id
    && evidence.run_id === attempt.run_id
    && evidence.case_id === attempt.case_id
    && evidence.attempt_id === attempt.id;
}

function exactStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.some((value) => !isIdentity(value))) return false;
  if (right.some((value) => !isIdentity(value))) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && leftSet.size === rightSet.size
    && [...leftSet].every((value) => rightSet.has(value));
}

function cleanPathPattern(value) {
  if (!isIdentity(value) || value.includes('\\') || value.startsWith('/')) {
    return false;
  }
  const parts = value.split('/');
  return !parts.includes('')
    && !parts.includes('.')
    && !parts.includes('..')
    && parts[0] !== '.git'
    && !/[*?\[]/.test(parts[0]);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function staticPrefix(pattern) {
  const wildcard = pattern.search(/[*?[]/);
  return (wildcard === -1 ? pattern : pattern.slice(0, wildcard))
    .replace(/\/+$/, '');
}

function patternsOverlap(left, right) {
  const leftPrefix = staticPrefix(left);
  const rightPrefix = staticPrefix(right);
  return leftPrefix === rightPrefix
    || leftPrefix.startsWith(`${rightPrefix}/`)
    || rightPrefix.startsWith(`${leftPrefix}/`);
}

function patternCovers(allowed, target) {
  if (allowed === target) return true;
  const allowedPrefix = staticPrefix(allowed);
  const targetPrefix = staticPrefix(target);
  return allowed.includes('*')
    && (
      targetPrefix === allowedPrefix
      || targetPrefix.startsWith(`${allowedPrefix}/`)
    );
}

function normalizeScope(scopeLock) {
  if (
    !isRecord(scopeLock)
    || !Array.isArray(scopeLock.allowed_files)
    || scopeLock.allowed_files.length === 0
    || !scopeLock.allowed_files.every(cleanPathPattern)
    || !Array.isArray(scopeLock.denied_files)
    || !scopeLock.denied_files.every(cleanPathPattern)
    || !Array.isArray(scopeLock.requires_review_on)
    || !scopeLock.requires_review_on.every(cleanPathPattern)
    || !isRecord(scopeLock.allowed_operations)
    || scopeLock.allowed_operations.create !== true
    || scopeLock.allowed_operations.modify !== true
    || scopeLock.allowed_operations.delete !== false
    || scopeLock.allowed_operations.rename !== false
  ) {
    return null;
  }
  const allowedFiles = sortedUnique(scopeLock.allowed_files);
  const deniedFiles = sortedUnique(scopeLock.denied_files);
  const reviewFiles = sortedUnique(scopeLock.requires_review_on);
  if (
    allowedFiles.some((allowed) => (
      deniedFiles.some((denied) => patternsOverlap(allowed, denied))
    ))
    || reviewFiles.some((review) => (
      !allowedFiles.some((allowed) => patternCovers(allowed, review))
      || deniedFiles.some((denied) => patternsOverlap(review, denied))
    ))
  ) {
    return null;
  }
  const fields = {
    owner: 'development',
    source: 'approved-development-scope-lock',
    allowed_files: allowedFiles,
    denied_files: deniedFiles,
    requires_review_on: reviewFiles,
    allowed_operations: {
      create: true,
      modify: true,
      delete: false,
      rename: false
    }
  };
  return {
    ...fields,
    digest: sha256(canonicalJson(fields))
  };
}

function fingerprintFromAttempt(attempt) {
  return {
    case_snapshot_hash: attempt.case_snapshot_hash,
    code_sha: attempt.code_sha,
    test_sha: attempt.test_sha,
    environment_hash: attempt.environment_hash,
    runtime_version: attempt.runtime_version,
    kernel_version: attempt.kernel_version
  };
}

function validateEvidence(schemaRegistry, packet, attempt, evidence) {
  if (!Array.isArray(evidence)) return null;
  const values = [];
  const ids = [];
  for (const candidate of evidence) {
    const value = schemaValue(schemaRegistry, 'evidence', candidate);
    if (
      !value
      || !sameIdentity(value, packet)
      || !evidenceMatchesAttempt(value, attempt)
      || FINGERPRINT_FIELDS.some((field) => value[field] !== attempt[field])
    ) {
      return null;
    }
    values.push(value);
    ids.push(value.id);
  }
  if (!exactStringSet(ids, packet.evidence_ids)) return null;
  return values.sort((left, right) => left.id.localeCompare(right.id));
}

function createDevelopmentRepairBridge(options = {}) {
  const {
    schemaRegistry,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-repair-bridge:config-invalid');
  }

  function routeRepair(request) {
    if (!isRecord(request)) {
      return blocked(blocker(
        'verification-repair-bridge:request-invalid',
        'repair-request'
      ));
    }
    const requestFields = Object.keys(request);
    if (requestFields.some((field) => BREAK_LOOP_FIELDS.has(field))) {
      return blocked(blocker(
        'verification-repair-bridge:signal-forwarding-forbidden',
        'repair-request'
      ));
    }
    const unexpectedField = requestFields.find((field) => (
      !REQUEST_FIELDS.has(field)
    ));
    if (unexpectedField) {
      return blocked(blocker(
        'verification-repair-bridge:request-invalid',
        'repair-request',
        unexpectedField
      ));
    }
    if (request.fallback_used !== false) {
      return blocked(blocker(
        'verification-repair-bridge:fallback-forbidden',
        'repair-request'
      ));
    }
    if (request.verification_mode !== 'full') {
      return blocked(blocker(
        'verification-repair-bridge:full-mode-required',
        'repair-request'
      ));
    }
    if (request.manual_green !== false) {
      return blocked(blocker(
        'verification-repair-bridge:manual-green-forbidden',
        'repair-request'
      ));
    }
    if (
      request.signals !== undefined
      && (
        !Array.isArray(request.signals)
        || request.signals.length > 0
      )
    ) {
      return blocked(blocker(
        'verification-repair-bridge:signal-forwarding-forbidden',
        'repair-request'
      ));
    }
    let input;
    try {
      input = structuredClone(request);
    } catch {
      return blocked(blocker(
        'verification-repair-bridge:request-invalid',
        'repair-request'
      ));
    }
    const packet = schemaValue(
      schemaRegistry,
      'failure-packet',
      input.failure_packet
    );
    if (!packet) {
      return blocked(blocker(
        'verification-repair-bridge:failure-packet-invalid',
        input.failure_packet?.id || 'failure-packet'
      ));
    }
    if (packet.classification === null || packet.status === 'open') {
      return blocked(blocker(
        'verification-repair-bridge:failure-packet-open',
        packet.id
      ));
    }
    if (
      !Object.hasOwn(REPAIR_KIND, packet.classification)
      || packet.owner !== 'development'
      || packet.status !== 'repair_required'
      || packet.next_action !== 'repair_required'
    ) {
      return blocked(blocker(
        'verification-repair-bridge:classification-not-eligible',
        packet.id,
        packet.classification
      ));
    }

    const attempt = schemaValue(schemaRegistry, 'attempt', input.attempt);
    if (!attempt || !attemptMatchesPacket(attempt, packet)) {
      return blocked(blocker(
        'verification-repair-bridge:attempt-binding-mismatch',
        input.attempt?.id || 'attempt'
      ));
    }
    const expectedFingerprint = fingerprintFromAttempt(attempt);
    if (canonicalJson(expectedFingerprint) !== canonicalJson(input.before_identity)) {
      return blocked(blocker(
        'verification-repair-bridge:before-identity-mismatch',
        attempt.id
      ));
    }

    const evidence = validateEvidence(
      schemaRegistry,
      packet,
      attempt,
      input.evidence
    );
    if (!evidence) {
      return blocked(blocker(
        'verification-repair-bridge:evidence-binding-mismatch',
        packet.id
      ));
    }
    const scope = normalizeScope(input.scope_lock);
    if (!scope) {
      return blocked(blocker(
        'verification-repair-bridge:scope-invalid',
        'scope-lock'
      ));
    }
    const requestedAt = clock();
    if (!validDate(requestedAt)) {
      return blocked(blocker(
        'verification-repair-bridge:clock-invalid',
        'clock'
      ));
    }
    const packetDigest = sha256(canonicalJson(packet));
    const evidenceContent = evidence.map((value) => ({
      id: value.id,
      digest: sha256(canonicalJson(value))
    }));
    const taskIdentity = {
      schema: 'specnav.development.repair-task.v1',
      failure_packet_id: packet.id,
      failure_packet_digest: packetDigest,
      classification: packet.classification,
      scope,
      before_identity: expectedFingerprint,
      evidence_content: evidenceContent
    };
    const developmentTaskId = `900-verification-repair-${sha256(
      canonicalJson(taskIdentity)
    ).slice(0, 16)}`;
    const developmentTask = deepFreeze({
      schema: 'specnav.development.repair-task.v1',
      id: developmentTaskId,
      change_id: packet.change_id,
      goal: `Repair ${packet.classification} for ${packet.case_id}.`,
      classification: packet.classification,
      owner: 'development',
      status: 'requested',
      requested_at: requestedAt,
      packet_path: `development/tasks/${developmentTaskId}`,
      scope,
      packet_artifacts: [...STANDARD_PACKET_ARTIFACTS],
      required_reviews: [...STANDARD_REVIEWS],
      ownership: OWNERSHIP,
      frozen_failure: {
        failure_packet_id: packet.id,
        failure_packet_digest: packetDigest,
        run_id: packet.run_id,
        case_id: packet.case_id,
        attempt_id: packet.attempt_id,
        evidence_ids: [...packet.evidence_ids].sort(),
        evidence_content: evidenceContent,
        reading_ids: [...packet.reading_ids].sort(),
        failed_assertion_ids: [...packet.failed_assertion_ids].sort(),
        summary: packet.summary,
        root_cause: packet.root_cause,
        frozen_at: packet.frozen_at
      }
    });
    const repairLinkFields = {
      schema: 'specnav.verification.repair-link.v1',
      failure_id: packet.id,
      change_id: packet.change_id,
      development_task_id: developmentTask.id,
      repair_kind: REPAIR_KIND[packet.classification],
      status: 'requested',
      requested_at: requestedAt,
      before_identity: expectedFingerprint,
      scope_digest: sha256(canonicalJson(scope))
    };
    const repairLinkIdentity = {
      schema: repairLinkFields.schema,
      failure_id: repairLinkFields.failure_id,
      change_id: repairLinkFields.change_id,
      development_task_id: repairLinkFields.development_task_id,
      repair_kind: repairLinkFields.repair_kind,
      status: repairLinkFields.status,
      before_identity: repairLinkFields.before_identity,
      scope_digest: repairLinkFields.scope_digest
    };
    const repairLink = schemaValue(schemaRegistry, 'repair-link', {
      ...repairLinkFields,
      id: `repair-${sha256(canonicalJson(repairLinkIdentity))}`
    });
    if (!repairLink) {
      return blocked(blocker(
        'verification-repair-bridge:repair-link-invalid',
        packet.id
      ));
    }

    return deepFreeze({
      ok: true,
      status: 'repair_requested',
      development_task: developmentTask,
      repair_link: repairLink,
      forwarded_signals: [],
      blockers: []
    });
  }

  function completeRepair(request) {
    const link = schemaValue(
      schemaRegistry,
      'repair-link',
      request?.repair_link
    );
    if (
      !link
      || !['requested', 'in_progress', 'reviewed'].includes(link.status)
      || !isRecord(request.after_identity)
      || !Array.isArray(request.reviews)
      || request.reviews.length !== COMPLETION_REVIEW_KINDS.length
    ) {
      return blocked(blocker(
        'verification-repair-bridge:completion-request-invalid',
        request?.repair_link?.id || 'repair-completion'
      ));
    }
    const reviews = new Map();
    for (const review of request.reviews) {
      if (
        !schemaValue(schemaRegistry, 'repair-review', review)
        || !COMPLETION_REVIEW_KINDS.includes(review.kind)
        || reviews.has(review.kind)
        || review.task_id !== link.development_task_id
        || review.failure_id !== link.failure_id
        || review.repair_link_id !== link.id
        || review.repair_link_digest !== sha256(canonicalJson(link))
        || review.scope_digest !== link.scope_digest
        || review.after_identity_digest
          !== sha256(canonicalJson(request.after_identity))
      ) {
        return blocked(blocker(
          'verification-repair-bridge:completion-review-invalid',
          review?.evidence_id || 'repair-review'
        ));
      }
      reviews.set(review.kind, review);
    }
    if (
      COMPLETION_REVIEW_KINDS.some((kind) => !reviews.has(kind))
      || new Set(
        [...reviews.values()].map((review) => review.reviewer_id)
      ).size !== COMPLETION_REVIEW_KINDS.length
    ) {
      return blocked(blocker(
        'verification-repair-bridge:completion-review-invalid',
        link.id
      ));
    }
    const changedField = link.repair_kind === 'product_code'
      ? 'code_sha'
      : link.repair_kind === 'test_code'
        ? 'test_sha'
        : null;
    if (!changedField) {
      return blocked(blocker(
        'verification-repair-bridge:completion-kind-invalid',
        link.id
      ));
    }
    for (const field of [
      'case_snapshot_hash',
      'environment_hash',
      'runtime_version',
      'kernel_version'
    ]) {
      if (request.after_identity[field] !== link.before_identity[field]) {
        return blocked(blocker(
          'verification-repair-bridge:completion-fingerprint-invalid',
          link.id,
          field
        ));
      }
    }
    if (
      request.after_identity[changedField] === link.before_identity[changedField]
    ) {
      return blocked(blocker(
        'verification-repair-bridge:completion-no-source-change',
        link.id,
        changedField
      ));
    }
    const completedAt = clock();
    if (!validDate(completedAt)) {
      return blocked(blocker(
        'verification-repair-bridge:clock-invalid',
        'clock'
      ));
    }
    const completed = schemaValue(schemaRegistry, 'repair-link', {
      ...link,
      status: 'completed',
      completed_at: completedAt,
      after_identity: request.after_identity,
      review_evidence_ids: [...reviews.values()]
        .map((review) => review.evidence_id)
        .sort()
    });
    if (!completed) {
      return blocked(blocker(
        'verification-repair-bridge:repair-link-invalid',
        link.id
      ));
    }
    return deepFreeze({
      ok: true,
      status: 'repair_completed',
      development_task: null,
      repair_link: completed,
      forwarded_signals: [],
      blockers: []
    });
  }

  return Object.freeze({ completeRepair, routeRepair });
}

module.exports = {
  OWNERSHIP,
  STANDARD_PACKET_ARTIFACTS,
  STANDARD_REVIEWS,
  createDevelopmentRepairBridge
};
