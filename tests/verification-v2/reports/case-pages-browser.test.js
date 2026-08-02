'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification');
const {
  managedRuntimeStatus
} = require('../browser/test-helpers');
const {
  validatedReportModel
} = require('./report-test-helpers');

test('real Chromium renders and filters catalog and immutable results', {
  timeout: 30000
}, async (t) => {
  const runtime = managedRuntimeStatus();
  assert.equal(runtime.ok, true, JSON.stringify(runtime.blockers));
  const runtimeRequire = createRequire(path.join(runtime.runtime_root, 'package.json'));
  const { chromium } = runtimeRequire('playwright');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-case-pages-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { model, schemaRegistry } = validatedReportModel('green', {}, {
    includeCaseHistory: true
  });
  const options = {
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  };
  const catalog = kernel.createCaseCatalogRenderer(options).render(model);
  const results = kernel.createCaseResultsRenderer(options).render(model);
  assert.equal(catalog.ok, true, JSON.stringify(catalog.blockers));
  assert.equal(results.ok, true, JSON.stringify(results.blockers));
  fs.writeFileSync(path.join(directory, catalog.file_name), catalog.html);
  fs.writeFileSync(path.join(directory, results.file_name), results.html);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const screenshotDirectory = process.env.SPECNAV_REPORT_SCREENSHOT_DIR;
  if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 }
  ]) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height }
    });
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(pathToFileURL(path.join(directory, catalog.file_name)).href);
    const caseRow = page.locator('[data-case-row]');
    assert.equal(await caseRow.isVisible(), true);
    await page.getByLabel('Search cases').fill('missing');
    assert.equal(await caseRow.isHidden(), true);
    await page.getByLabel('Search cases').fill('validate');
    assert.equal(await caseRow.isVisible(), true);
    assert.equal(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )), true, `catalog:${viewport.name}`);
    if (screenshotDirectory) {
      await page.screenshot({
        fullPage: true,
        path: path.join(
          screenshotDirectory,
          `025-case-catalog-${viewport.name}.png`
        )
      });
    }

    await page.goto(pathToFileURL(path.join(directory, results.file_name)).href);
    for (const text of [
      'run-minimal',
      'attempt-minimal',
      'reading-facticity',
      'evidence-facticity'
    ]) {
      assert.equal(await page.getByText(text, { exact: false }).first().isVisible(), true);
    }
    assert.equal(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )), true, `results:${viewport.name}`);
    if (screenshotDirectory) {
      await page.screenshot({
        fullPage: true,
        path: path.join(
          screenshotDirectory,
          `025-case-results-${viewport.name}.png`
        )
      });
    }
    assert.deepEqual(consoleErrors, []);
    await page.close();
  }
});
