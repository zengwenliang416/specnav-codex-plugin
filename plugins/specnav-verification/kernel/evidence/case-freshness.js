'use strict';

const {
  compareFingerprintSet
} = require('./fingerprint-comparator');

const RUN_FINGERPRINT_FIELDS = Object.freeze([
  'case_snapshot_hash',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]);

const CASE_FINGERPRINT_FIELDS = Object.freeze([
  'browser_project',
  'test_data_snapshot'
]);

const CASE_FRESHNESS_FIELDS = Object.freeze([
  ...RUN_FINGERPRINT_FIELDS,
  ...CASE_FINGERPRINT_FIELDS
]);

function blocker(id, artifact, detail) {
  return { id, artifact, detail };
}

function invalidResult(detail) {
  return {
    ok: false,
    checked_at: null,
    summary: {
      status: 'unknown',
      total: 0,
      fresh: 0,
      stale: 0,
      unknown: 0
    },
    cases: [],
    blockers: [
      blocker(
        'verification-freshness:request-invalid',
        'case-freshness',
        detail
      )
    ]
  };
}

function currentTimestamp(clock) {
  try {
    const value = clock();
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentity(value) {
  return typeof value === 'string' && value.length > 0;
}

function latestAttempt(attempts, caseId, runId, changeId) {
  const caseCandidates = attempts.filter((attempt) => (
    attempt?.case_id === caseId
  ));
  const identityMissing = [];
  for (const attempt of caseCandidates) {
    for (const field of ['id', 'run_id', 'change_id']) {
      if (!isIdentity(attempt?.[field]) && !identityMissing.includes(field)) {
        identityMissing.push(field);
      }
    }
  }
  if (identityMissing.length > 0) {
    return {
      attempt: null,
      ambiguous: false,
      sequence: null,
      identityMissing
    };
  }
  const candidates = caseCandidates.filter((attempt) => (
    attempt?.case_id === caseId
    && attempt?.run_id === runId
    && attempt?.change_id === changeId
  ));
  if (candidates.length === 0) {
    return {
      attempt: null,
      ambiguous: false,
      sequence: null,
      identityMissing: []
    };
  }
  const sequences = candidates.map((attempt) => attempt?.sequence);
  if (sequences.some((sequence) => (
    !Number.isInteger(sequence) || sequence < 1
  ))) {
    return {
      attempt: null,
      ambiguous: true,
      sequence: 'invalid',
      identityMissing: []
    };
  }
  const sequence = Math.max(...sequences);
  const latest = candidates.filter((attempt) => attempt.sequence === sequence);
  return {
    attempt: latest.length === 1 ? latest[0] : null,
    ambiguous: latest.length !== 1,
    sequence,
    identityMissing: []
  };
}

function sourceFingerprints(run, attempt) {
  const source = {};
  for (const field of RUN_FINGERPRINT_FIELDS) source[field] = run[field];
  for (const field of CASE_FINGERPRINT_FIELDS) source[field] = attempt[field];
  return source;
}

function currentCaseFingerprints(current, caseId) {
  const source = {};
  for (const field of RUN_FINGERPRINT_FIELDS) source[field] = current[field];
  const caseValues = isRecord(current.cases) ? current.cases[caseId] : null;
  for (const field of CASE_FINGERPRINT_FIELDS) {
    source[field] = isRecord(caseValues) ? caseValues[field] : null;
  }
  return source;
}

function runAttemptConflicts(run, attempt) {
  return RUN_FINGERPRINT_FIELDS.filter((field) => (
    typeof run[field] === 'string'
    && typeof attempt[field] === 'string'
    && run[field] !== attempt[field]
  ));
}

function runAttemptMissing(run, attempt) {
  return RUN_FINGERPRINT_FIELDS.filter((field) => (
    typeof run[field] !== 'string'
    || run[field].length === 0
    || typeof attempt[field] !== 'string'
    || attempt[field].length === 0
  ));
}

function caseResult(caseId, attempt, comparison, timestamp) {
  const reasons = [
    ...comparison.currentMissing.map((field) => `${field}:current-missing`),
    ...comparison.sourceMissing.map((field) => `${field}:source-missing`),
    ...comparison.mismatches.map((field) => `${field}:mismatch`)
  ];
  const blockers = [
    ...comparison.currentMissing.map((field) => blocker(
      'verification-freshness:current-fingerprint-missing',
      caseId,
      field
    )),
    ...comparison.sourceMissing.map((field) => blocker(
      'verification-freshness:source-fingerprint-missing',
      caseId,
      field
    )),
    ...comparison.mismatches.map((field) => blocker(
      'verification-freshness:fingerprint-mismatch',
      caseId,
      field
    ))
  ];
  return {
    fact: {
      case_id: caseId,
      attempt_id: attempt.id,
      checked_at: timestamp,
      status: comparison.status,
      reasons
    },
    blockers
  };
}

function createCaseFreshnessEvaluator(options = {}) {
  const { clock = () => new Date().toISOString() } = options;
  if (typeof clock !== 'function') {
    throw new Error('verification-freshness:config-invalid');
  }

  function evaluate(request) {
    let input;
    try {
      input = structuredClone(request);
    } catch {
      return invalidResult('request-unreadable');
    }
    if (
      !isRecord(input)
      || !isRecord(input.caseSnapshot)
      || !Array.isArray(input.caseSnapshot.cases)
      || !isRecord(input.run)
      || !Array.isArray(input.run.case_ids)
      || !Array.isArray(input.attempts)
      || !isRecord(input.currentFingerprints)
    ) {
      return invalidResult('request-invalid');
    }
    if (!isIdentity(input.run.id) || !isIdentity(input.run.change_id)) {
      return invalidResult('run-identity-invalid');
    }
    if (
      !isIdentity(input.caseSnapshot.id)
      || !isIdentity(input.caseSnapshot.change_id)
      || !isIdentity(input.run.case_snapshot_id)
    ) {
      return invalidResult('case-snapshot-identity-invalid');
    }
    if (
      input.caseSnapshot.id !== input.run.case_snapshot_id
      || input.caseSnapshot.change_id !== input.run.change_id
    ) {
      return invalidResult('case-snapshot-run-identity-mismatch');
    }

    const timestamp = currentTimestamp(clock);
    if (!timestamp) return invalidResult('clock-invalid');

    const caseIds = [];
    const seen = new Set();
    for (const testCase of input.caseSnapshot.cases) {
      const caseId = testCase?.id;
      if (
        typeof caseId !== 'string'
        || caseId.length === 0
        || seen.has(caseId)
      ) {
        return invalidResult('case-snapshot-invalid');
      }
      seen.add(caseId);
      caseIds.push(caseId);
    }
    if (caseIds.length === 0) return invalidResult('case-snapshot-empty');
    if (
      typeof input.caseSnapshot.snapshot_hash !== 'string'
      || typeof input.run.case_snapshot_hash !== 'string'
    ) {
      return invalidResult('case-snapshot-hash-invalid');
    }
    if (input.caseSnapshot.snapshot_hash !== input.run.case_snapshot_hash) {
      return {
        ok: false,
        checked_at: timestamp,
        summary: {
          status: 'unknown',
          total: caseIds.length,
          fresh: 0,
          stale: 0,
          unknown: caseIds.length
        },
        cases: caseIds.map((caseId) => ({
          case_id: caseId,
          attempt_id: null,
          checked_at: timestamp,
          status: 'unknown',
          reasons: ['case_snapshot_hash:source-conflict']
        })),
        blockers: caseIds.map((caseId) => blocker(
          'verification-freshness:snapshot-run-mismatch',
          caseId,
          'case_snapshot_hash'
        ))
      };
    }

    const facts = [];
    const blockers = [];
    const runCases = new Set(input.run.case_ids);
    for (const caseId of caseIds) {
      if (!runCases.has(caseId)) {
        facts.push({
          case_id: caseId,
          attempt_id: null,
          checked_at: timestamp,
          status: 'unknown',
          reasons: ['run:case-missing']
        });
        blockers.push(blocker(
          'verification-freshness:run-case-missing',
          caseId,
          'case_id'
        ));
        continue;
      }

      const selected = latestAttempt(
        input.attempts,
        caseId,
        input.run.id,
        input.run.change_id
      );
      if (selected.identityMissing.length > 0) {
        facts.push({
          case_id: caseId,
          attempt_id: null,
          checked_at: timestamp,
          status: 'unknown',
          reasons: ['attempt:identity-missing']
        });
        blockers.push(...selected.identityMissing.map((field) => blocker(
          'verification-freshness:attempt-identity-missing',
          caseId,
          field
        )));
        continue;
      }
      if (selected.ambiguous) {
        facts.push({
          case_id: caseId,
          attempt_id: null,
          checked_at: timestamp,
          status: 'unknown',
          reasons: ['attempt:ambiguous']
        });
        blockers.push(blocker(
          'verification-freshness:attempt-ambiguous',
          caseId,
          `sequence:${selected.sequence}`
        ));
        continue;
      }
      const attempt = selected.attempt;
      if (!attempt) {
        facts.push({
          case_id: caseId,
          attempt_id: null,
          checked_at: timestamp,
          status: 'unknown',
          reasons: ['attempt:source-missing']
        });
        blockers.push(blocker(
          'verification-freshness:attempt-missing',
          caseId,
          'attempt'
        ));
        continue;
      }

      const missingSource = runAttemptMissing(input.run, attempt);
      if (missingSource.length > 0) {
        facts.push({
          case_id: caseId,
          attempt_id: attempt.id,
          checked_at: timestamp,
          status: 'unknown',
          reasons: missingSource.map((field) => `${field}:source-missing`)
        });
        blockers.push(...missingSource.map((field) => blocker(
          'verification-freshness:source-fingerprint-missing',
          caseId,
          field
        )));
        continue;
      }

      const conflicts = runAttemptConflicts(input.run, attempt);
      if (conflicts.length > 0) {
        facts.push({
          case_id: caseId,
          attempt_id: attempt.id,
          checked_at: timestamp,
          status: 'unknown',
          reasons: conflicts.map((field) => `${field}:source-conflict`)
        });
        blockers.push(...conflicts.map((field) => blocker(
          'verification-freshness:run-attempt-fingerprint-mismatch',
          caseId,
          field
        )));
        continue;
      }

      const comparison = compareFingerprintSet(
        sourceFingerprints(input.run, attempt),
        currentCaseFingerprints(input.currentFingerprints, caseId),
        CASE_FRESHNESS_FIELDS
      );
      const result = caseResult(caseId, attempt, comparison, timestamp);
      facts.push(result.fact);
      blockers.push(...result.blockers);
    }

    const fresh = facts.filter((fact) => fact.status === 'fresh').length;
    const stale = facts.filter((fact) => fact.status === 'stale').length;
    const unknown = facts.filter((fact) => fact.status === 'unknown').length;
    const status = unknown > 0 ? 'unknown' : stale > 0 ? 'stale' : 'fresh';

    return {
      ok: blockers.length === 0 && status === 'fresh',
      checked_at: timestamp,
      summary: {
        status,
        total: facts.length,
        fresh,
        stale,
        unknown
      },
      cases: facts,
      blockers
    };
  }

  return Object.freeze({ evaluate });
}

module.exports = {
  RUN_FINGERPRINT_FIELDS,
  CASE_FINGERPRINT_FIELDS,
  CASE_FRESHNESS_FIELDS,
  createCaseFreshnessEvaluator
};
