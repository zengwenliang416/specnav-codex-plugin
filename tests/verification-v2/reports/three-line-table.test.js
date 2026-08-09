'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification');
const {
  validatedReportModel
} = require('./report-test-helpers');

function renderedReports() {
  const { model, schemaRegistry } = validatedReportModel('green', {}, {
    includeCaseHistory: true
  });
  const options = {
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  };
  return [
    kernel.createOverviewRenderer(options).render(model),
    kernel.createCaseCatalogRenderer(options).render(model),
    kernel.createCaseResultsRenderer(options).render(model)
  ];
}

test('all report pages embed the shared three-line table contract', () => {
  for (const report of renderedReports()) {
    assert.equal(report.ok, true, JSON.stringify(report.blockers));
    assert.match(report.html, /table\s*\{[^}]*border-top:\s*2px solid var\(--ink\);/s);
    assert.match(report.html, /table\s*\{[^}]*border-bottom:\s*2px solid var\(--ink\);/s);
    assert.match(report.html, /thead\s*\{[^}]*border-bottom:\s*1px solid var\(--border-strong\);/s);
    assert.match(report.html, /th,\s*td\s*\{[^}]*border:\s*0;/s);
    assert.match(report.html, /tbody tr\s*\{[^}]*border:\s*0;/s);
    assert.match(report.html, /thead th\s*\{[^}]*background:\s*transparent;/s);
    assert.doesNotMatch(report.html, /th,\s*td\s*\{[^}]*border-bottom:/s);
  }
});

test('print styles preserve the academic three-line table weights', () => {
  for (const report of renderedReports()) {
    assert.match(report.html, /@media print\s*\{[\s\S]*table\s*\{[^}]*border-top:\s*1\.5pt solid #000;/);
    assert.match(report.html, /@media print\s*\{[\s\S]*table\s*\{[^}]*border-bottom:\s*1\.5pt solid #000;/);
    assert.match(report.html, /@media print\s*\{[\s\S]*thead\s*\{[^}]*border-bottom:\s*0\.75pt solid #000;/);
  }
});

test('rendered tables retain captions, scoped headers, and keyboard scroll regions', () => {
  const [overview, catalog, results] = renderedReports();
  assert.match(overview.html, /class="table-scroll" role="region"[^>]*tabindex="0"/);
  assert.match(overview.html, /<caption>Six-domain verification status<\/caption>/);
  assert.match(overview.html, /<th scope="col">Domain<\/th>/);
  assert.match(overview.html, /<th scope="row">Facticity<\/th>/);

  assert.doesNotMatch(catalog.html, /<table(?:\s|>)/);

  assert.match(results.html, /class="table-scroll" role="region"[^>]*tabindex="0"/);
  assert.match(results.html, /<caption>Readings for case case-minimal<\/caption>/);
  assert.match(results.html, /<th scope="col">Reading<\/th>/);
  assert.match(results.html, /<th scope="row"><code>reading-facticity<\/code><\/th>/);
});
