'use strict';

function readableString(record, field) {
  try {
    const value = record?.[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function compareFingerprintSet(source, current, fields) {
  if (
    !Array.isArray(fields)
    || fields.length === 0
    || fields.some((field) => typeof field !== 'string' || field.length === 0)
  ) {
    throw new Error('verification-freshness:fields-invalid');
  }

  const currentMissing = [];
  const sourceMissing = [];
  const mismatches = [];

  for (const field of fields) {
    const sourceValue = readableString(source, field);
    const currentValue = readableString(current, field);
    if (!currentValue) {
      currentMissing.push(field);
      continue;
    }
    if (!sourceValue) {
      sourceMissing.push(field);
      continue;
    }
    if (sourceValue !== currentValue) mismatches.push(field);
  }

  const status = currentMissing.length > 0 || sourceMissing.length > 0
    ? 'unknown'
    : mismatches.length > 0
      ? 'stale'
      : 'fresh';

  return Object.freeze({
    status,
    currentMissing: Object.freeze(currentMissing),
    sourceMissing: Object.freeze(sourceMissing),
    mismatches: Object.freeze(mismatches)
  });
}

module.exports = {
  compareFingerprintSet
};
