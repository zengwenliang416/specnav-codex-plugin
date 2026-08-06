'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  commandFor
} = require('../../../plugins/specnav-verification/scripts/host-verification-adapter');

const ROOT = path.resolve(__dirname, '../../..');
const PLUGIN = path.join(ROOT, 'plugins', 'specnav-verification');
const PROJECT = path.join(ROOT, 'tests', 'fixtures', 'simple-project');

function command(action, options = {}) {
  return commandFor(PLUGIN, {
    action,
    project_root: PROJECT,
    options
  });
}

test('host execute and finalize actions route to the Verification 2.0 CLI', () => {
  const execute = command('execute', {
    change: 'change-v2',
    reviewer_id: 'reviewer-1',
    scenario_registry: 'verification-scenarios.js',
    attempt_kind: 'retest',
    parent_attempt: 'attempt-failed',
    failure_id: 'failure-open'
  });
  const finalize = command('finalize', {
    change: 'change-v2',
    reviewer_id: 'reviewer-1'
  });

  assert.equal(path.basename(execute[0]), 'verification-v2-run.js');
  assert.equal(execute[1], 'run');
  assert.equal(
    execute.includes('--scenario-registry'),
    true
  );
  for (const [flag, value] of [
    ['--attempt-kind', 'retest'],
    ['--parent-attempt', 'attempt-failed'],
    ['--failure-id', 'failure-open']
  ]) {
    const index = execute.indexOf(flag);
    assert.notEqual(index, -1, flag);
    assert.equal(execute[index + 1], value, flag);
  }
  assert.equal(path.basename(finalize[0]), 'verification-v2-run.js');
  assert.equal(finalize[1], 'finalize');
});

test('validate aggregate and report use V2 while legacy actions remain explicit', () => {
  for (const action of ['validate', 'aggregate', 'report']) {
    const routed = command(action, {
      change: 'change-v2',
      reviewer_id: 'reviewer-1'
    });
    assert.equal(path.basename(routed[0]), 'verification-v2-run.js', action);
  }
  for (const action of [
    'legacy-validate',
    'legacy-aggregate',
    'legacy-report'
  ]) {
    const routed = command(action);
    assert.equal(path.basename(routed[0]), 'verify-domains.js', action);
  }
});

test('repair actions route to the dedicated append-only repair-loop CLI', () => {
  const classified = command('repair-classify', {
    change: 'change-v2',
    reviewer_id: 'reviewer-1',
    failure_id: 'failure-open',
    root_cause_check: 'openspec/changes/change-v2/root-cause.json',
    no_progress: '2'
  });
  assert.equal(
    path.basename(classified[0]),
    'verification-v2-repair-loop.js'
  );
  assert.equal(classified[1], 'classify');
  for (const [flag, value] of [
    ['--failure-id', 'failure-open'],
    ['--root-cause-check', 'openspec/changes/change-v2/root-cause.json'],
    ['--no-progress', '2']
  ]) {
    const index = classified.indexOf(flag);
    assert.notEqual(index, -1, flag);
    assert.equal(classified[index + 1], value, flag);
  }

  const applied = command('repair-transition-apply', {
    change: 'change-v2',
    reviewer_id: 'reviewer-1',
    failure_id: 'failure-open',
    proposal_id: 'transition-close',
    idempotency_key: 'apply-close-failure'
  });
  assert.equal(applied[1], 'transition-apply');
  assert.equal(
    applied[applied.indexOf('--proposal-id') + 1],
    'transition-close'
  );
  assert.equal(
    applied[applied.indexOf('--idempotency-key') + 1],
    'apply-close-failure'
  );
});
