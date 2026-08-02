'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification');
const {
  validatedReportModel
} = require('./report-test-helpers');

function renderers(verdict = 'green') {
  const { model, schemaRegistry } = validatedReportModel(verdict, {}, {
    includeCaseHistory: true
  });
  const options = {
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  };
  return {
    catalog: kernel.createCaseCatalogRenderer(options),
    model,
    results: kernel.createCaseResultsRenderer(options)
  };
}

test('catalog renders approved case contracts with shared navigation', () => {
  const { catalog, model } = renderers();
  const result = catalog.render(model);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.file_name, 'test-case-catalog.html');
  assert.match(result.html, /aria-current="page"[^>]*>Test case catalog/);
  assert.match(result.html, /case-minimal/);
  assert.match(result.html, /Validate the V2 contract/);
  assert.match(result.html, /Validate the fixture/);
  assert.match(result.html, /The schema accepts the fixture/);
  assert.match(result.html, /Facticity/);
  assert.match(result.html, /structured_comparison/);
  assert.match(result.html, /data-report-component="case-filter"/);
});

test('results render immutable run attempt reading and evidence history', () => {
  const { model, results } = renderers();
  const result = results.render(model);

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.file_name, 'test-case-results.html');
  assert.match(result.html, /aria-current="page"[^>]*>Case results/);
  for (const value of [
    'run-minimal',
    'attempt-minimal',
    'reading-facticity',
    'evidence-facticity',
    'objects/evidence-facticity.json',
    'structured_comparison'
  ]) {
    assert.match(result.html, new RegExp(value));
  }
  assert.match(result.html, /Expected/);
  assert.match(result.html, /Actual/);
  assert.match(result.html, /SHA-256/);
  assert.match(result.html, /Freshness/);
});

test('empty and blocked pages remain complete instead of hiding state', () => {
  const { model, schemaRegistry } = validatedReportModel('blocked');
  const options = {
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  };
  const catalog = kernel.createCaseCatalogRenderer(options).render(model);
  const results = kernel.createCaseResultsRenderer(options).render(model);

  assert.equal(catalog.ok, true);
  assert.equal(results.ok, true);
  assert.match(catalog.html, /No approved test cases/);
  assert.match(results.html, /No immutable case results/);
  for (const html of [catalog.html, results.html]) {
    assert.match(html, /verification-runtime:not-ready/);
    assert.match(html, /HTML is a projection, not the gate source of truth/);
  }
});

test('all verdicts keep the same page responsibilities and hierarchy', () => {
  for (const verdict of [
    'green',
    'red',
    'blocked',
    'running',
    'canceled',
    'stale',
    'flaky',
    'pass_after_fix'
  ]) {
    const { catalog, model, results } = renderers(verdict);
    const catalogHtml = catalog.render(model).html;
    const resultsHtml = results.render(model).html;
    assert.match(catalogHtml, /data-report-page="catalog"/);
    assert.match(resultsHtml, /data-report-page="results"/);
    assert.match(catalogHtml, /data-report-section="case-contracts"/);
    assert.match(resultsHtml, /data-report-section="case-results"/);
  }
});

test('renderers reject invalid models and expose no fallback pages', () => {
  const { schemaRegistry } = validatedReportModel('green');
  const options = {
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  };
  for (const renderer of [
    kernel.createCaseCatalogRenderer(options),
    kernel.createCaseResultsRenderer(options)
  ]) {
    const result = renderer.render({ verdict: 'green' });
    assert.equal(result.ok, false);
    assert.equal(result.html, null);
  }
});
