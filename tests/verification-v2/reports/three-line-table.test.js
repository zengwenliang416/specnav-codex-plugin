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
    assert.match(report.html, /\.three-line-table\s*\{[^}]*border-top:\s*1\.5pt solid #111;/s);
    assert.match(report.html, /\.three-line-table\s*\{[^}]*border-bottom:\s*1\.5pt solid #111;/s);
    assert.match(report.html, /\.three-line-table thead\s*\{[^}]*border-bottom:\s*0\.75pt solid #111;/s);
    assert.match(report.html, /\.three-line-table th,\s*\.three-line-table td\s*\{[^}]*border:\s*0;/s);
    assert.match(report.html, /\.three-line-table tbody tr\s*\{[^}]*border:\s*0;/s);
    assert.match(report.html, /\.three-line-table thead th\s*\{[^}]*background:\s*transparent;/s);
    assert.match(report.html, /\.three-line-table caption\s*\{[^}]*position:\s*static;/s);
    assert.match(report.html, /\.three-line-table caption\s*\{[^}]*text-align:\s*center;/s);
    assert.match(report.html, /\.table-note\s*\{/s);
    assert.doesNotMatch(report.html, /\.three-line-table th,\s*\.three-line-table td\s*\{[^}]*border-bottom:/s);
  }
});

test('print styles preserve the academic three-line table weights', () => {
  for (const report of renderedReports()) {
    assert.match(report.html, /@media print\s*\{[\s\S]*\.three-line-table\s*\{[^}]*border-top:\s*1\.5pt solid #000;/);
    assert.match(report.html, /@media print\s*\{[\s\S]*\.three-line-table\s*\{[^}]*border-bottom:\s*1\.5pt solid #000;/);
    assert.match(report.html, /@media print\s*\{[\s\S]*\.three-line-table thead\s*\{[^}]*display:\s*table-header-group;/);
    assert.match(report.html, /@media print\s*\{[\s\S]*\.three-line-table thead\s*\{[^}]*border-bottom:\s*0\.75pt solid #000;/);
  }
});

test('rendered tables retain captions, scoped headers, and keyboard scroll regions', () => {
  const [overview, catalog, results] = renderedReports();
  assert.match(overview.html, /class="table-scroll" role="region"[^>]*tabindex="0"/);
  assert.match(overview.html, /<table class="three-line-table domain-table">/);
  assert.match(overview.html, /<caption>Table 1\. Six-domain verification status<\/caption>/);
  assert.match(overview.html, /<th scope="col">Domain<\/th>/);
  assert.match(overview.html, /<th scope="row">Facticity<\/th>/);
  assert.match(overview.html, /<p class="table-note"><strong>Note\.<\/strong>/);

  assert.doesNotMatch(catalog.html, /<table(?:\s|>)/);

  assert.match(results.html, /class="table-scroll" role="region"[^>]*tabindex="0"/);
  assert.match(results.html, /<table class="three-line-table">/);
  assert.match(results.html, /<caption>Table 1\. Readings for case case-minimal<\/caption>/);
  assert.match(results.html, /<th scope="col">Reading<\/th>/);
  assert.match(results.html, /<th scope="row"><code>reading-facticity<\/code><\/th>/);
  assert.match(results.html, /<p class="table-note"><strong>Note\.<\/strong>/);
});
