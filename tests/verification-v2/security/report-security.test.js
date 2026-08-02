'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification');
const {
  createSafeRenderer,
  renderReportShell
} = require('../../../plugins/specnav-verification/kernel/reporting/report-shell');
const {
  resolveReportScripts,
  verifyPinnedScript
} = require('../../../plugins/specnav-verification/kernel/reporting/report-security');
const {
  loadReportStylesheet
} = require('../../../plugins/specnav-verification/kernel/reporting/report-assets');
const {
  validatedReportModel
} = require('../reports/report-test-helpers');

const ROOT = path.resolve(__dirname, '../../..');
const REPORT_CSS = path.join(
  ROOT,
  'plugins/specnav-verification/assets/report/report.css'
);

function renderAll(model, schemaRegistry, secrets = []) {
  const options = {
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets })
  };
  return [
    kernel.createOverviewRenderer(options).render(model),
    kernel.createCaseCatalogRenderer(options).render(model),
    kernel.createCaseResultsRenderer(options).render(model)
  ];
}

function parseCsp(html) {
  const match = html.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/
  );
  assert.ok(match, 'standalone report must declare a CSP');
  return match[1];
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((entry) => (
    channel(Number.parseInt(entry, 16))
  ));
  return (
    0.2126 * channels[0]
    + 0.7152 * channels[1]
    + 0.0722 * channels[2]
  );
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (
    (Math.max(first, second) + 0.05)
    / (Math.min(first, second) + 0.05)
  );
}

test('standalone reports use one independently pinned script and reject unknown script identities', () => {
  const { model, schemaRegistry } = validatedReportModel('green', {}, {
    includeCaseHistory: true
  });
  const rendered = renderAll(model, schemaRegistry);

  for (const report of rendered) {
    assert.equal(report.ok, true, JSON.stringify(report.blockers));
    const csp = parseCsp(report.html);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(
      report.html,
      /\son[a-z]+\s*=/i,
      `${report.file_name}:inline-handler`
    );

    const scripts = [
      ...report.html.matchAll(
        /<script data-specnav-report-script="([^"]+)">([\s\S]*?)<\/script>/g
      )
    ];
    if (scripts.length === 0) {
      assert.match(csp, /script-src 'none'/);
      continue;
    }
    assert.deepEqual(
      scripts.map((match) => match[1]),
      ['catalog-filter']
    );
    assert.match(
      csp,
      /script-src 'sha256-pP2lkv1kk7eUyTCmpaLFnLwQrtQGdnBI73\/ECqhmo\/M='/
    );
  }

  const unapproved = resolveReportScripts(['caller-controlled-script']);
  assert.equal(unapproved.ok, false);
  assert.deepEqual(
    unapproved.blockers.map((entry) => entry.id),
    ['verification-report-renderer:script-not-approved']
  );
  assert.equal(
    verifyPinnedScript('catalog-filter', 'window.changed=true'),
    false
  );
  const pinMismatch = resolveReportScripts(
    ['catalog-filter'],
    Object.freeze({ 'catalog-filter': 'window.changed=true' })
  );
  assert.equal(pinMismatch.ok, false);
  assert.deepEqual(
    pinMismatch.blockers.map((entry) => entry.id),
    ['verification-report-renderer:script-pin-mismatch']
  );
});

test('shell escapes its title and rejects unapproved scripts or active raw content', () => {
  const { model } = validatedReportModel('green');
  const redactor = kernel.createSecretRedactor({ secrets: [] });
  const safeTitle = createSafeRenderer(redactor);
  const html = renderReportShell({
    activePage: 'overview',
    body: '<article>trusted body</article>',
    model,
    safe: safeTitle,
    scriptIds: [],
    stylesheet: loadReportStylesheet(),
    title: '</title><script>window.reportCompromised=true</script>'
  });
  assert.match(
    html,
    /<title>&lt;\/title&gt;&lt;script&gt;window\.reportCompromised=true&lt;\/script&gt;<\/title>/
  );
  assert.doesNotMatch(html, /<script>window\.reportCompromised/);

  const rejected = createSafeRenderer(redactor);
  assert.equal(renderReportShell({
    activePage: 'overview',
    body: '<article>trusted body</article>',
    model,
    safe: rejected,
    scriptIds: ['caller-controlled-script'],
    stylesheet: loadReportStylesheet(),
    title: 'Report'
  }), null);
  assert.deepEqual(
    rejected.blockers.map((entry) => entry.id),
    ['verification-report-renderer:script-not-approved']
  );

  const activeBody = createSafeRenderer(redactor);
  assert.equal(renderReportShell({
    activePage: 'overview',
    body: '<article><script>window.reportCompromised=true</script></article>',
    model,
    safe: activeBody,
    scriptIds: [],
    stylesheet: loadReportStylesheet(),
    title: 'Report'
  }), null);
  assert.deepEqual(
    activeBody.blockers.map((entry) => entry.id),
    ['verification-report-renderer:body-active-content']
  );

  const alteredStylesheet = createSafeRenderer(redactor);
  assert.equal(renderReportShell({
    activePage: 'overview',
    body: '<article>trusted body</article>',
    model,
    safe: alteredStylesheet,
    scriptIds: [],
    stylesheet: `${loadReportStylesheet()}\nbody{display:none}`,
    title: 'Report'
  }), null);
  assert.deepEqual(
    alteredStylesheet.blockers.map((entry) => entry.id),
    ['verification-report-renderer:stylesheet-pin-mismatch']
  );
});

test('all dynamic report fields are redacted before hostile HTML is escaped', () => {
  const configuredSecret = 'configured-report-secret';
  const credentialSecrets = [
    'bearer-report-secret',
    'cookie-report-secret',
    'cli-report-secret'
  ];
  const { model: frozen, schemaRegistry } = validatedReportModel('green', {}, {
    includeCaseHistory: true
  });
  const model = structuredClone(frozen);
  model.catalog[0].title = (
    `<img src=x onerror="send('${configuredSecret}')">`
  );
  model.catalog[0].goal = (
    'Authorization: Bearer bearer-report-secret'
  );
  model.catalog[0].steps[0].action = (
    '<script>window.reportCompromised = true</script>'
  );
  model.results[0].command.args = [
    '--token=cli-report-secret',
    'Cookie: session=cookie-report-secret'
  ];
  model.blockers = [{
    id: '<svg onload=alert(1)>',
    artifact: 'report.html',
    detail: `provider=${configuredSecret}`
  }];

  for (const report of renderAll(
    model,
    schemaRegistry,
    [configuredSecret]
  )) {
    assert.equal(report.ok, true, JSON.stringify(report.blockers));
    for (const secret of [configuredSecret, ...credentialSecrets]) {
      assert.doesNotMatch(report.html, new RegExp(secret));
    }
    assert.doesNotMatch(
      report.html,
      /<img src=x|<svg onload|<script[^>]*>window\.reportCompromised/
    );
    assert.match(report.html, /\[REDACTED\]/);
  }
});

test('report status colors meet WCAG AA contrast on both report surfaces', () => {
  const css = fs.readFileSync(REPORT_CSS, 'utf8');
  const tokens = Object.fromEntries(
    [...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((match) => (
      [match[1], match[2]]
    ))
  );
  for (const foreground of [
    'ink',
    'muted',
    'green',
    'red',
    'amber',
    'blue',
    'teal',
    'gray'
  ]) {
    for (const background of ['surface', 'surface-subtle']) {
      assert.ok(
        contrast(tokens[foreground], tokens[background]) >= 4.5,
        `${foreground} on ${background}`
      );
    }
  }
});

test('editing emitted HTML cannot change the DecisionEngine result', (t) => {
  const { model, schemaRegistry } = validatedReportModel('blocked');
  const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
  const engine = kernel.createDecisionEngine({
    schemaRegistry,
    aggregator,
    clock: () => '2026-08-02T00:00:00Z'
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-gate-html-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const report = kernel.createOverviewRenderer({
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  }).render(model);
  assert.equal(report.ok, true);
  const reportPath = path.join(directory, report.file_name);
  fs.writeFileSync(reportPath, report.html);
  const request = {
    change_id: 'verification-2-0',
    stage: 'release',
    aggregation_request: {
      change_id: 'verification-2-0',
      case_ids: [],
      readings: [],
      evidence: [],
      integrity: {
        ok: false,
        facts: null,
        blockers: []
      },
      policy_facts: {
        not_applicable_decisions: [],
        terminal_states: []
      }
    },
    evidence_index_version: 1,
    runtime_version: '2.0.0',
    kernel_version: '2.0.0-alpha.1',
    freshness: {
      status: 'fresh',
      checked_at: '2026-08-02T00:00:00Z',
      reasons: []
    },
    integrity_status: 'intact',
    policy_version: 'verification-policy-v1',
    open_failure_ids: []
  };
  const requestPath = path.join(directory, 'gate-request.json');
  fs.writeFileSync(requestPath, JSON.stringify(request));
  const before = engine.decide(JSON.parse(fs.readFileSync(requestPath)));
  fs.writeFileSync(
    reportPath,
    fs.readFileSync(reportPath, 'utf8').replaceAll('BLOCKED', 'PASS')
  );
  const edited = engine.decide(JSON.parse(fs.readFileSync(requestPath)));

  assert.equal(before.status, 'blocked');
  assert.deepEqual(edited, before);
  assert.equal(edited.gate.decision, 'block');
});
