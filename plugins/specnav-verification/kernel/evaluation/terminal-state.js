'use strict';

const SIX_DOMAINS = Object.freeze([
  'facticity',
  'static',
  'unit',
  'redteam',
  'e2e',
  'sensory'
]);

const TERMINAL_STATES = Object.freeze([
  'pass',
  'fail',
  'blocked',
  'flaky',
  'pass_after_fix',
  'stale',
  'canceled',
  'not_applicable'
]);

const TERMINAL_PRECEDENCE = Object.freeze({
  not_applicable: 0,
  pass: 1,
  pass_after_fix: 2,
  flaky: 3,
  canceled: 4,
  stale: 5,
  fail: 6,
  blocked: 7
});

function strongestTerminalState(states) {
  return [...states].sort((left, right) => (
    TERMINAL_PRECEDENCE[right] - TERMINAL_PRECEDENCE[left]
    || left.localeCompare(right)
  ))[0] || 'blocked';
}

function applyCaseTerminalFact(states, factStatus) {
  const failClosed = states.filter((status) => (
    ['blocked', 'fail', 'stale', 'canceled'].includes(status)
  ));
  if (failClosed.length > 0) return strongestTerminalState(failClosed);
  if (['flaky', 'pass_after_fix'].includes(factStatus)) return factStatus;
  return strongestTerminalState([...states, factStatus]);
}

module.exports = {
  SIX_DOMAINS,
  TERMINAL_PRECEDENCE,
  TERMINAL_STATES,
  applyCaseTerminalFact,
  strongestTerminalState
};
