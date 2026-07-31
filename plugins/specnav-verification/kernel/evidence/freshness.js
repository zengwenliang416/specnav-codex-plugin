'use strict';

const { blocked } = require('./blockers');
const {
  compareFingerprintSet
} = require('./fingerprint-comparator');

const FRESHNESS_FIELDS = Object.freeze([
  'case_snapshot_hash',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]);

function checkedAt(clock) {
  try {
    const value = clock();
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function evaluateFreshness(evidence, current, clock) {
  const timestamp = checkedAt(clock);
  const comparison = compareFingerprintSet(
    evidence,
    current,
    FRESHNESS_FIELDS
  );
  const missing = comparison.currentMissing;
  if (!timestamp || missing.length > 0) {
    const fields = [
      ...missing,
      ...(!timestamp ? ['checked_at'] : [])
    ].sort();
    return {
      ok: false,
      freshness: {
        status: 'unknown',
        checked_at: timestamp || '1970-01-01T00:00:00.000Z',
        reasons: fields.map((field) => `${field}:missing`)
      },
      blockers: blocked(
        'verification-evidence:freshness-context-incomplete',
        evidence.id,
        fields.join(',')
      ).blockers
    };
  }

  const sourceMissing = comparison.sourceMissing;
  if (sourceMissing.length > 0) {
    return {
      ok: false,
      freshness: {
        status: 'unknown',
        checked_at: timestamp,
        reasons: sourceMissing.map((field) => `${field}:source-missing`)
      },
      blockers: blocked(
        'verification-evidence:source-fingerprint-incomplete',
        evidence?.id || 'evidence',
        [...sourceMissing].sort().join(',')
      ).blockers
    };
  }

  const mismatches = comparison.mismatches;
  if (mismatches.length === 0) {
    return {
      ok: true,
      freshness: {
        status: 'fresh',
        checked_at: timestamp,
        reasons: []
      },
      blockers: []
    };
  }

  return {
    ok: false,
    freshness: {
      status: 'stale',
      checked_at: timestamp,
      reasons: mismatches.map((field) => `${field}:mismatch`)
    },
    blockers: mismatches.map((field) => ({
      id: 'verification-evidence:fingerprint-mismatch',
      artifact: evidence.id,
      detail: `${field}:${current[field]}:${evidence[field]}`
    }))
  };
}

module.exports = {
  FRESHNESS_FIELDS,
  evaluateFreshness
};
