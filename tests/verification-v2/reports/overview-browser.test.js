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

function renderBlockedOverview() {
  const { model, schemaRegistry } = validatedReportModel('blocked', {
    blockers: [{
      id: 'verification-evidence:missing',
      artifact: 'evidence-001',
      detail: 'Expected evidence object is missing.'
    }]
  });
  return kernel.createOverviewRenderer({
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  }).render(model);
}

async function tabSequence(page, count) {
  const sequence = [];
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Tab');
    sequence.push(await page.evaluate(() => ({
      href: document.activeElement?.getAttribute('href') || null,
      tag: document.activeElement?.tagName || null
    })));
  }
  return sequence;
}

test('real Chromium preserves mobile, keyboard, and print report facts', {
  timeout: 30000
}, async (t) => {
  const runtime = managedRuntimeStatus();
  assert.equal(runtime.ok, true, JSON.stringify(runtime.blockers));
  const runtimeRequire = createRequire(path.join(
    runtime.runtime_root,
    'package.json'
  ));
  const { chromium } = runtimeRequire('playwright');
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-overview-browser-')
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'overview.html');
  const rendered = renderBlockedOverview();
  assert.equal(rendered.ok, true, JSON.stringify(rendered.blockers));
  fs.writeFileSync(file, rendered.html);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const screenshotDirectory = process.env.SPECNAV_REPORT_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
  }

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
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });

    assert.deepEqual(await tabSequence(page, 5), [
      { href: '#report-content', tag: 'A' },
      { href: 'overview.html', tag: 'A' },
      { href: 'overview.html', tag: 'A' },
      { href: 'test-case-catalog.html', tag: 'A' },
      { href: 'test-case-results.html', tag: 'A' }
    ]);
    assert.equal(await page.evaluate(() => (
      document.documentElement.scrollWidth
      <= document.documentElement.clientWidth
    )), true, viewport.name);

    if (screenshotDirectory) {
      await page.screenshot({
        fullPage: true,
        path: path.join(
          screenshotDirectory,
          `024-overview-report-${viewport.name}.png`
        )
      });
    }

    await page.emulateMedia({ media: 'print' });
    assert.equal(
      await page.locator('.report-navigation').evaluate((element) => (
        getComputedStyle(element).display
      )),
      'none'
    );
    for (const selector of [
      '[data-report-section="release-verdict"]',
      '[data-report-section="blockers"]',
      '[data-report-section="sources"]'
    ]) {
      assert.equal(
        await page.locator(selector).isVisible(),
        true,
        `${viewport.name}:${selector}`
      );
    }
    assert.equal(
      await page.getByText('verification-evidence:missing').isVisible(),
      true
    );
    assert.equal(await page.getByText('evidence-001').first().isVisible(), true);
    assert.equal(
      await page.getByText('a'.repeat(64)).isVisible(),
      true
    );
    assert.deepEqual(consoleErrors, []);
    await page.close();
  }
});
