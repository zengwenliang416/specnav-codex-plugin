'use strict';

const { canonicalJson } = require('../evidence/identity');

const STATUS_PRECEDENCE = Object.freeze({
  not_applicable: 0,
  pass: 1,
  pass_after_fix: 2,
  flaky: 3,
  running: 4,
  canceled: 5,
  stale: 6,
  fail: 7,
  blocked: 8
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableIds(values) {
  return [...new Set(values.filter((value) => (
    typeof value === 'string' && value.length > 0
  )))].sort();
}

function stableBlockers(values) {
  const normalized = new Map();
  for (const value of values.filter(isRecord)) {
    if (typeof value.id !== 'string' || value.id.length === 0) continue;
    const entry = {
      id: value.id,
      artifact: value.artifact === undefined ? null : value.artifact,
      detail: value.detail === undefined || value.detail === null
        ? null
        : typeof value.detail === 'string'
          ? value.detail
          : canonicalJson(value.detail)
    };
    const key = canonicalJson(entry);
    if (!normalized.has(key)) normalized.set(key, entry);
  }
  return [...normalized.values()].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ));
}

function byId(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

function byAttempt(left, right) {
  return left.sequence - right.sequence
    || left.started_at.localeCompare(right.started_at)
    || left.id.localeCompare(right.id);
}

function byRun(left, right) {
  return Date.parse(left.created_at) - Date.parse(right.created_at)
    || left.id.localeCompare(right.id);
}

function strongestStatus(values) {
  return [...values].sort((left, right) => (
    STATUS_PRECEDENCE[right] - STATUS_PRECEDENCE[left]
    || left.localeCompare(right)
  ))[0] || 'blocked';
}

function commandProjection(testCase) {
  const runner = isRecord(testCase?.runner) ? testCase.runner : {};
  return {
    runner: runner.kind || 'command',
    entrypoint: runner.entrypoint || null,
    args: Array.isArray(runner.args) ? [...runner.args] : [],
    cwd: runner.cwd || null,
    env_keys: stableIds(Array.isArray(runner.env_keys) ? runner.env_keys : [])
  };
}

module.exports = {
  byAttempt,
  byId,
  byRun,
  commandProjection,
  isRecord,
  stableBlockers,
  stableIds,
  strongestStatus
};
