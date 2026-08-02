'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification');
const {
  DOMAIN_NAMES,
  reportModel,
  validatedReportModel
} = require('./report-test-helpers');

const ROOT = path.resolve(__dirname, '../../..');
const OVERVIEW_SOURCE = path.join(
  ROOT,
  'plugins/specnav-verification/kernel/reporting/overview-renderer.js'
);

function renderer(verdict = 'green', options = {}) {
  const { model, schemaRegistry } = validatedReportModel(verdict);
  return {
    model,
    renderer: kernel.createOverviewRenderer({
      schemaRegistry,
      secretRedactor: kernel.createSecretRedactor({
        secrets: options.secrets || []
      })
    })
  };
}

test('renders a standalone overview from one validated report model', () => {
  const { model, renderer: subject } = renderer('green');
  const result = subject.render(model);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.file_name, 'overview.html');
  assert.match(result.html, /^<!doctype html>/);
  assert.match(result.html, /<style data-specnav-report-styles>/);
  assert.doesNotMatch(result.html, /<link[^>]+stylesheet/);
  assert.match(result.html, /data-report-model-id="report-model-green"/);
  assert.match(result.html, /HTML is a projection, not the gate source of truth\./);
});

test('keeps the same information architecture for all eight verdicts', () => {
  const verdicts = [
    'green',
    'red',
    'blocked',
    'running',
    'canceled',
    'stale',
    'flaky',
    'pass_after_fix'
  ];
  const landmarks = [
    'data-report-section="release-verdict"',
    'data-report-section="lifecycle"',
    'data-report-section="metrics"',
    'data-report-section="six-domains"',
    'data-report-section="blockers"',
    'data-report-section="freshness-integrity"',
    'data-report-section="repair-loop"',
    'data-report-section="sources"'
  ];

  for (const verdict of verdicts) {
    const { model, renderer: subject } = renderer(verdict);
    const result = subject.render(model);
    assert.equal(result.ok, true, verdict);
    assert.match(result.html, new RegExp(`data-report-verdict="${verdict}"`));
    let cursor = -1;
    for (const landmark of landmarks) {
      const next = result.html.indexOf(landmark);
      assert.equal(next > cursor, true, `${verdict}:${landmark}`);
      cursor = next;
    }
    for (const domain of DOMAIN_NAMES) {
      assert.match(result.html, new RegExp(`data-domain="${domain}"`));
    }
  }
});

test('uses shared link navigation for all three report pages', () => {
  const { model, renderer: subject } = renderer('green');
  const html = subject.render(model).html;

  assert.match(html, /href="overview\.html"[^>]*aria-current="page"/);
  assert.match(html, /href="test-case-catalog\.html"/);
  assert.match(html, /href="test-case-results\.html"/);
  assert.doesNotMatch(html, /<button[^>]+data-view=/);
});

test('blocked, running, and empty models still render complete reports', () => {
  const blocked = renderer('blocked');
  const blockedResult = blocked.renderer.render(blocked.model);
  assert.equal(blockedResult.ok, true);
  assert.match(blockedResult.html, /data-report-state="empty"/);
  assert.match(blockedResult.html, /No approved test cases/);
  assert.match(blockedResult.html, /Case execution remains blocked/);

  const running = renderer('running');
  const runningResult = running.renderer.render(running.model);
  assert.equal(runningResult.ok, true);
  assert.match(runningResult.html, /data-report-state="populated"/);

  for (const result of [blockedResult, runningResult]) {
    assert.match(result.html, /data-report-section="sources"/);
    assert.match(result.html, /data-report-section="six-domains"/);
  }
});

test('shows exact blockers, freshness, integrity, repair, and source references', () => {
  const { model, schemaRegistry } = validatedReportModel('blocked', {
    blockers: [{
      id: 'verification-evidence:missing',
      artifact: 'evidence-001',
      detail: 'Expected evidence object is missing.'
    }]
  });
  const subject = kernel.createOverviewRenderer({
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  });
  const html = subject.render(model).html;

  assert.match(html, /verification-evidence:missing/);
  assert.match(html, /evidence-001/);
  assert.match(html, /Expected evidence object is missing\./);
  assert.match(html, /Next action:/);
  assert.match(html, /rebuild the Evidence Index/);
  assert.match(html, />UNKNOWN</);
  assert.match(html, />NOT STARTED</);
  assert.match(html, /snapshot-001/);
  assert.match(html, /a{64}/);

  const green = renderer('green');
  const greenHtml = green.renderer.render(green.model).html;
  assert.match(greenHtml, /reading-001/);
  assert.match(greenHtml, /evidence-001/);
});

test('renders warning, stale reason, and repair ids instead of hiding report facts', () => {
  const flaky = renderer('flaky');
  assert.match(
    flaky.renderer.render(flaky.model).html,
    /verification-report:flaky/
  );

  const stale = renderer('stale');
  assert.match(
    stale.renderer.render(stale.model).html,
    /code_sha:mismatch/
  );

  const repaired = renderer('pass_after_fix');
  const repairedHtml = repaired.renderer.render(repaired.model).html;
  assert.match(repairedHtml, /failure-001/);
  assert.match(repairedHtml, /repair-001/);
  for (const stage of [
    'initial',
    'failure',
    'repair',
    'retest',
    'regression'
  ]) {
    assert.match(repairedHtml, new RegExp(`data-repair-stage="${stage}"`));
  }
});

test('escapes and redacts every dynamic blocker text value', () => {
  const secret = 'provider-secret-value';
  const { schemaRegistry } = validatedReportModel('blocked');
  const validation = schemaRegistry.validate('report-model', reportModel(
    'blocked',
    {
      blockers: [{
        id: '<script>alert(1)</script>',
        artifact: 'runtime-status.json',
        detail: `credential=${secret}`
      }]
    }
  ));
  assert.equal(validation.ok, true, JSON.stringify(validation.blockers));
  const subject = kernel.createOverviewRenderer({
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [secret] })
  });
  const html = subject.render(validation.value).html;

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, new RegExp(secret));
  assert.match(html, /\[REDACTED\]/);
});

test('rejects invalid or unvalidated models without rendering a fallback page', () => {
  const { schemaRegistry } = validatedReportModel('green');
  const subject = kernel.createOverviewRenderer({
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  });
  const result = subject.render({
    schema: 'specnav.verification.report-model.v1',
    verdict: 'green'
  });

  assert.equal(result.ok, false);
  assert.equal(result.html, null);
  assert.equal(result.blockers.some((entry) => (
    entry.id === 'verification-report-renderer:model-invalid'
  )), true);
});

test('rejects forged schema registries and hostile status values', () => {
  assert.throws(
    () => kernel.createOverviewRenderer({
      schemaRegistry: {
        validate(_type, candidate) {
          return { ok: true, value: candidate, blockers: [] };
        }
      },
      secretRedactor: kernel.createSecretRedactor({ secrets: [] })
    }),
    /verification-report-renderer:config-invalid/
  );

  const { model, schemaRegistry } = validatedReportModel('green');
  const hostile = structuredClone(model);
  hostile.verdict = 'green><img src=x onerror=alert(1)';
  const subject = kernel.createOverviewRenderer({
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  });
  const result = subject.render(hostile);
  assert.equal(result.ok, false);
  assert.equal(result.html, null);
});

test('output is deterministic and does not mutate the model', () => {
  const { model, renderer: subject } = renderer('pass_after_fix');
  const before = structuredClone(model);
  const first = subject.render(model);
  const second = subject.render(model);

  assert.equal(first.html, second.html);
  assert.deepEqual(model, before);
  assert.equal(Object.isFrozen(first), true);
});

test('production overview renderer does not read raw verification artifacts', () => {
  const source = fs.readFileSync(OVERVIEW_SOURCE, 'utf8');
  assert.doesNotMatch(source, /JSON\.parse|readFile|raw\.jsonl|evidence-index/);
  assert.doesNotMatch(source, /fallback|light mode|simplified/i);
});

test('report has no theme or runtime locale controls', () => {
  const { model, renderer: subject } = renderer('green');
  const html = subject.render(model).html;

  assert.doesNotMatch(html, /theme-toggle|locale-switch|language-switch/);
  assert.doesNotMatch(html, /prefers-color-scheme:\s*dark/);
  assert.doesNotMatch(html, /font-size:\s*clamp\(/);
  assert.match(html, /color-scheme:\s*light/);
  assert.match(html, /class="status-icon"/);
});
