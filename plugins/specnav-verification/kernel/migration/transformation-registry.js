'use strict';

const crypto = require('node:crypto');

const DOMAINS = new Set([
  'facticity',
  'static',
  'unit',
  'redteam',
  'e2e',
  'sensory'
]);
const LEGACY_VERDICTS = new Set([
  'pass',
  'green',
  'fail',
  'red',
  'blocked'
]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function stableReadingId(migrationId, sourceId) {
  const candidate = `${migrationId}:${sourceId}`;
  if (STABLE_ID.test(candidate)) return candidate;
  return `${migrationId}:${crypto.createHash('sha256')
    .update(String(sourceId))
    .digest('hex')
    .slice(0, 24)}`;
}

function validLegacyReading(value, changeId) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.schema === 'specnav.verification.legacy-reading.v1'
    && STABLE_ID.test(value.id || '')
    && value.change_id === changeId
    && STABLE_ID.test(value.run_id || '')
    && STABLE_ID.test(value.case_id || '')
    && STABLE_ID.test(value.attempt_id || '')
    && (
      STABLE_ID.test(value.step_id || '')
      || STABLE_ID.test(value.assertion_id || '')
    )
    && DOMAINS.has(value.domain)
    && LEGACY_VERDICTS.has(value.verdict)
    && value.oracle
    && typeof value.oracle === 'object'
    && Array.isArray(value.evidence_ids)
    && typeof value.recorded_at === 'string'
    && typeof value.code_sha === 'string'
    && typeof value.test_sha === 'string';
}

function passIsProven(source, integrityChecker) {
  if (
    !source.evidence_request
    || typeof source.evidence_request !== 'object'
    || Array.isArray(source.evidence_request)
  ) {
    return {
      proven: false,
      integrity: null,
      blockers: []
    };
  }
  const request = source.evidence_request.graph
      && typeof source.evidence_request.graph === 'object'
      && !Array.isArray(source.evidence_request.graph)
    ? {
        ...structuredClone(source.evidence_request.graph),
        currentFingerprints: structuredClone(
          source.evidence_request.currentFingerprints
        )
      }
    : source.evidence_request;
  let result;
  try {
    result = integrityChecker.checkIntegrity(request);
  } catch (error) {
    return {
      proven: false,
      integrity: null,
      blockers: [blocker(
        'verification-migration:evidence-check-failed',
        source.id,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
  const summary = result?.facts?.summary;
  return {
    proven: result?.ok === true
      && summary?.integrity === 'intact'
      && summary?.freshness === 'fresh',
    integrity: summary ? structuredClone(summary) : null,
    blockers: Array.isArray(result?.blockers)
      ? structuredClone(result.blockers)
      : []
  };
}

function transformLegacyReading(options) {
  const {
    source,
    sourceRef,
    migrationId,
    changeId,
    integrityChecker,
    schemaRegistry
  } = options;
  if (!validLegacyReading(source, changeId)) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-migration:legacy-artifact-invalid',
        sourceRef.path
      )]
    };
  }

  const legacyPass = ['pass', 'green'].includes(source.verdict);
  const legacyFail = ['fail', 'red'].includes(source.verdict);
  const evidence = legacyPass
    ? passIsProven(source, integrityChecker)
    : { proven: false, integrity: null, blockers: [] };
  const verdict = legacyPass
    ? evidence.proven ? 'pass' : 'blocked'
    : legacyFail ? 'fail' : 'blocked';
  const blockerIds = legacyPass && !evidence.proven
    ? ['verification-migration:legacy-pass-unverified']
    : [];
  const reading = {
    schema: 'specnav.verification.reading.v1',
    id: stableReadingId(migrationId, source.id),
    change_id: changeId,
    run_id: source.run_id,
    case_id: source.case_id,
    attempt_id: source.attempt_id,
    ...(source.step_id ? { step_id: source.step_id } : {}),
    ...(source.assertion_id ? { assertion_id: source.assertion_id } : {}),
    domain: source.domain,
    expected: structuredClone(source.expected),
    actual: structuredClone(source.actual),
    oracle: structuredClone(source.oracle),
    evidence_ids: structuredClone(source.evidence_ids),
    verdict,
    recorded_at: source.recorded_at,
    code_sha: source.code_sha,
    test_sha: source.test_sha
  };
  const validation = schemaRegistry.validate('reading', reading, {
    artifactPath: `migration://${migrationId}/${source.id}`
  });
  if (!validation?.ok) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-migration:reading-schema-invalid',
        sourceRef.path,
        JSON.stringify(validation?.blockers || [])
      )]
    };
  }
  return {
    ok: true,
    value: {
      artifact_kind: 'verification-migrated-reading',
      format_version: 1,
      migration_id: migrationId,
      source_id: source.id,
      source_verdict: source.verdict,
      requires_rerun: verdict !== 'pass',
      blocker_ids: blockerIds,
      source_ref: structuredClone(sourceRef),
      evidence_integrity: evidence.integrity,
      evidence_blockers: evidence.blockers,
      reading: validation.value || reading
    },
    blockers: []
  };
}

function createTransformationRegistry(options = {}) {
  const { integrityChecker, schemaRegistry } = options;
  if (
    !integrityChecker
    || typeof integrityChecker.checkIntegrity !== 'function'
    || !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
  ) {
    throw new Error('verification-migration:transform-config-invalid');
  }

  function transform(request) {
    if (request?.source?.schema !== 'specnav.verification.legacy-reading.v1') {
      return {
        ok: false,
        blockers: [blocker(
          'verification-migration:legacy-schema-unsupported',
          request?.sourceRef?.path || 'legacy-artifact'
        )]
      };
    }
    return transformLegacyReading({
      ...request,
      integrityChecker,
      schemaRegistry
    });
  }

  return Object.freeze({ transform });
}

module.exports = {
  createTransformationRegistry,
  transformLegacyReading
};
