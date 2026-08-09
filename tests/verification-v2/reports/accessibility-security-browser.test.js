'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
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

const PAGES = Object.freeze([
  Object.freeze({
    file: 'overview.html',
    page: 'overview',
    printFacts: [
      '[data-report-section="release-verdict"]',
      '[data-report-section="six-domains"]',
      '[data-report-section="sources"]'
    ]
  }),
  Object.freeze({
    file: 'test-case-catalog.html',
    page: 'catalog',
    printFacts: [
      '[data-report-section="case-contracts"]',
      '.contract-list',
      '[data-report-section="blockers"]'
    ]
  }),
  Object.freeze({
    file: 'test-case-results.html',
    page: 'results',
    printFacts: [
      '[data-report-section="case-results"]',
      '.history-list',
      '.evidence-grid'
    ]
  })
]);

const ARTIFACT_DIRECTORY = process.env.SPECNAV_REPORT_ARTIFACT_DIR || null;
const ARTIFACTS = [];

if (ARTIFACT_DIRECTORY) {
  assert.equal(
    fs.existsSync(ARTIFACT_DIRECTORY),
    false,
    `artifact destination already exists: ${ARTIFACT_DIRECTORY}`
  );
  fs.mkdirSync(ARTIFACT_DIRECTORY, { recursive: false });
}

test.after(() => {
  if (!ARTIFACT_DIRECTORY) return;
  const manifest = {
    schema: 'specnav.verification.report-browser-artifacts.v1',
    task_id: '026-report-accessibility-security',
    run_id: process.env.SPECNAV_REPORT_ARTIFACT_RUN_ID,
    generated_at: process.env.SPECNAV_REPORT_GENERATED_AT,
    command_id: process.env.SPECNAV_REPORT_COMMAND_ID,
    source_sha: process.env.SPECNAV_REPORT_SOURCE_SHA,
    source_patch_sha256: process.env.SPECNAV_REPORT_SOURCE_PATCH_SHA256,
    artifacts: ARTIFACTS.map((artifact) => {
      const bytes = fs.readFileSync(artifact.file);
      return {
        ...artifact.metadata,
        file: path.relative(ARTIFACT_DIRECTORY, artifact.file),
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length
      };
    })
  };
  const manifestPath = path.join(ARTIFACT_DIRECTORY, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' }
  );
  process.stdout.write(`${JSON.stringify({
    artifact_directory: ARTIFACT_DIRECTORY,
    manifest: manifestPath,
    manifest_sha256: crypto.createHash('sha256')
      .update(fs.readFileSync(manifestPath))
      .digest('hex'),
    artifact_count: manifest.artifacts.length
  })}\n`);
});

function renderReports(directory, verdict = 'green') {
  const { model, schemaRegistry } = validatedReportModel(verdict, {}, {
    includeCaseHistory: verdict === 'green'
  });
  const options = {
    schemaRegistry,
    secretRedactor: kernel.createSecretRedactor({ secrets: [] })
  };
  const rendered = [
    kernel.createOverviewRenderer(options).render(model),
    kernel.createCaseCatalogRenderer(options).render(model),
    kernel.createCaseResultsRenderer(options).render(model)
  ];
  for (const report of rendered) {
    assert.equal(report.ok, true, JSON.stringify(report.blockers));
    fs.writeFileSync(path.join(directory, report.file_name), report.html);
  }
}

function artifactPath(name, metadata) {
  if (!ARTIFACT_DIRECTORY) return null;
  const file = path.join(ARTIFACT_DIRECTORY, name);
  assert.equal(fs.existsSync(file), false, `artifact exists: ${file}`);
  ARTIFACTS.push({ file, metadata });
  return file;
}

function pdfText(pdf) {
  const result = spawnSync('pdftotext', ['-', '-'], {
    input: pdf,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(
    result.status,
    0,
    `pdftotext is required for print verification: ${result.stderr || ''}`
  );
  return result.stdout.replace(/\s+/g, ' ').trim();
}

function pdfFacts(pdf) {
  const result = spawnSync('pdfinfo', ['-'], {
    input: pdf,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  assert.equal(
    result.status,
    0,
    `pdfinfo is required for print verification: ${result.stderr || ''}`
  );
  const pages = Number(result.stdout.match(/^Pages:\s+(\d+)$/m)?.[1]);
  const tagged = result.stdout.match(/^Tagged:\s+(\w+)$/m)?.[1];
  const javaScript = result.stdout.match(/^JavaScript:\s+(\w+)$/m)?.[1];
  assert.ok(Number.isInteger(pages) && pages > 0, result.stdout);
  assert.equal(tagged, 'yes', result.stdout);
  assert.equal(javaScript, 'no', result.stdout);
  return { pages, tagged: true, javascript: false };
}

async function focusFacts(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return {
      href: element?.getAttribute('href') || null,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      tag: element?.tagName || null
    };
  });
}

async function assertSharedSemantics(page, pageName) {
  assert.equal(await page.locator('header.report-header').count(), 1);
  assert.equal(await page.locator('nav.report-navigation').count(), 1);
  assert.equal(await page.locator('main#report-content').count(), 1);
  assert.equal(await page.locator('footer.report-footer').count(), 1);
  assert.equal(
    await page.locator('.report-navigation [aria-current="page"]').count(),
    1
  );
  assert.equal(
    await page.locator('.status-badge').evaluateAll((badges) => (
      badges.every((badge) => (
        badge.textContent.trim().length > 0
        && badge.querySelector('[aria-hidden="true"]')
      ))
    )),
    true,
    `${pageName}:status-text`
  );
  assert.equal(
    await page.locator('table').evaluateAll((tables) => (
      tables.every((table) => (
        table.querySelector('caption')
        && [...table.querySelectorAll('thead th')].every((cell) => (
          cell.getAttribute('scope') === 'col'
        ))
        && [...table.querySelectorAll('tbody th')].every((cell) => (
          cell.getAttribute('scope') === 'row'
        ))
      ))
    )),
    true,
    `${pageName}:semantic-tables`
  );

  await page.keyboard.press('Tab');
  const skip = await focusFacts(page);
  assert.deepEqual(
    { href: skip.href, tag: skip.tag },
    { href: '#report-content', tag: 'A' }
  );
  assert.notEqual(skip.outlineStyle, 'none', `${pageName}:skip-focus-style`);
  assert.notEqual(skip.outlineWidth, '0px', `${pageName}:skip-focus-width`);
  await page.keyboard.press('Enter');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'report-content',
    `${pageName}:skip-target`
  );
}

async function assertThreeLineTables(page, pageName) {
  const tables = page.locator('table');
  const count = await tables.count();
  for (let index = 0; index < count; index += 1) {
    const facts = await tables.nth(index).evaluate((table) => {
      const style = getComputedStyle(table);
      const head = table.querySelector('thead');
      const headStyle = getComputedStyle(head);
      const cells = [...table.querySelectorAll('th, td')];
      const rows = [...table.querySelectorAll('tbody tr')];
      return {
        bottom: [style.borderBottomStyle, style.borderBottomWidth],
        cellBordersAbsent: cells.every((cell) => {
          const cellStyle = getComputedStyle(cell);
          return [
            cellStyle.borderTopWidth,
            cellStyle.borderRightWidth,
            cellStyle.borderBottomWidth,
            cellStyle.borderLeftWidth
          ].every((width) => width === '0px');
        }),
        header: [headStyle.borderBottomStyle, headStyle.borderBottomWidth],
        rowBordersAbsent: rows.every((row) => {
          const rowStyle = getComputedStyle(row);
          return [
            rowStyle.borderTopWidth,
            rowStyle.borderRightWidth,
            rowStyle.borderBottomWidth,
            rowStyle.borderLeftWidth
          ].every((width) => width === '0px');
        }),
        top: [style.borderTopStyle, style.borderTopWidth]
      };
    });
    assert.deepEqual(facts.top, ['solid', '2px'], `${pageName}:table-${index}:top`);
    assert.deepEqual(facts.header, ['solid', '1px'], `${pageName}:table-${index}:header`);
    assert.deepEqual(facts.bottom, ['solid', '2px'], `${pageName}:table-${index}:bottom`);
    assert.equal(facts.cellBordersAbsent, true, `${pageName}:table-${index}:cells`);
    assert.equal(facts.rowBordersAbsent, true, `${pageName}:table-${index}:rows`);
  }
}

test('all report pages are responsive, keyboard operable, semantic, and printable', {
  timeout: 45000
}, async (t) => {
  const runtime = managedRuntimeStatus();
  assert.equal(runtime.ok, true, JSON.stringify(runtime.blockers));
  const runtimeRequire = createRequire(path.join(runtime.runtime_root, 'package.json'));
  const { chromium } = runtimeRequire('playwright');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-report-a11y-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  renderReports(directory);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 }
  ]) {
    for (const report of PAGES) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      await page.goto(pathToFileURL(path.join(directory, report.file)).href, {
        waitUntil: 'load'
      });

      await assertSharedSemantics(page, report.page);
      await assertThreeLineTables(page, report.page);
      assert.equal(await page.evaluate(() => (
        document.documentElement.scrollWidth
        <= document.documentElement.clientWidth
      )), true, `${report.page}:${viewport.name}:overflow`);

      if (report.page === 'catalog') {
        await page.getByLabel('Search cases').focus();
        const searchFocus = await focusFacts(page);
        assert.notEqual(searchFocus.outlineStyle, 'none');
        await page.keyboard.type('missing');
        assert.equal(await page.locator('[data-case-row]').isHidden(), true);
        await page.getByLabel('Search cases').fill('validate');
        assert.equal(await page.locator('[data-case-row]').isVisible(), true);
        const priorityFilter = page.getByLabel('Filter by priority');
        await priorityFilter.focus();
        await page.keyboard.type('P0');
        assert.equal(
          await priorityFilter.inputValue(),
          'P0'
        );
        assert.equal(await page.locator('[data-case-row]').isHidden(), true);
        await priorityFilter.selectOption('');
        assert.equal(await page.locator('[data-case-row]').isVisible(), true);
      }

      if (report.page === 'results') {
        const indexLink = page.locator('.case-index a').first();
        await indexLink.focus();
        await page.keyboard.press('Enter');
        assert.match(page.url(), /#result-case-minimal$/);
        const evidenceLink = page.locator('.evidence-item a').first();
        await evidenceLink.focus();
        const evidenceFocus = await focusFacts(page);
        assert.match(evidenceFocus.href, /^evidence\/objects\//);
        assert.notEqual(evidenceFocus.outlineStyle, 'none');
      }

      const screenshot = artifactPath(
        `green-${report.page}-${viewport.name}.png`,
        {
          kind: 'screenshot',
          verdict: 'green',
          page: report.page,
          viewport: viewport.name
        }
      );
      if (screenshot) {
        await page.screenshot({
          fullPage: true,
          path: screenshot
        });
      }

      await page.emulateMedia({ media: 'print' });
      await assertThreeLineTables(page, `${report.page}:print`);
      assert.equal(
        await page.locator('.report-navigation').evaluate((element) => (
          getComputedStyle(element).display
        )),
        'none'
      );
      for (const selector of report.printFacts) {
        assert.equal(
          await page.locator(selector).first().isVisible(),
          true,
          `${report.page}:${viewport.name}:print:${selector}`
        );
      }
      assert.equal(
        await page.getByText(
          'HTML is a projection, not the gate source of truth.'
        ).isVisible(),
        true
      );
      assert.deepEqual(consoleErrors, [], `${report.page}:${viewport.name}:console`);
      await page.close();
    }
  }
});

test('Chromium blocks an injected script while the approved catalog script still runs', {
  timeout: 45000
}, async (t) => {
  const runtime = managedRuntimeStatus();
  assert.equal(runtime.ok, true, JSON.stringify(runtime.blockers));
  const runtimeRequire = createRequire(path.join(runtime.runtime_root, 'package.json'));
  const { chromium } = runtimeRequire('playwright');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-report-csp-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  renderReports(directory);
  const catalogPath = path.join(directory, 'test-case-catalog.html');
  fs.writeFileSync(
    catalogPath,
    fs.readFileSync(catalogPath, 'utf8').replace(
      '</body>',
      '<script>window.__specnavUnauthorized=true</script></body>'
    )
  );

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const consoleMessages = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.goto(pathToFileURL(catalogPath).href, { waitUntil: 'load' });

  assert.equal(
    await page.evaluate(() => window.__specnavUnauthorized),
    undefined
  );
  await page.getByLabel('Search cases').fill('missing');
  assert.equal(await page.locator('[data-case-row]').isHidden(), true);
  assert.equal(
    consoleMessages.some((message) => (
      /content security policy|refused to execute inline script/i.test(message)
    )),
    true,
    JSON.stringify(consoleMessages)
  );
});

test('real paginated PDFs preserve exact green and blocked report facts', {
  timeout: 45000
}, async (t) => {
  const runtime = managedRuntimeStatus();
  assert.equal(runtime.ok, true, JSON.stringify(runtime.blockers));
  const runtimeRequire = createRequire(path.join(runtime.runtime_root, 'package.json'));
  const { chromium } = runtimeRequire('playwright');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-report-print-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const verdict of ['green', 'blocked']) {
    const verdictDirectory = path.join(directory, verdict);
    fs.mkdirSync(verdictDirectory);
    renderReports(verdictDirectory, verdict);
    for (const report of PAGES) {
      const page = await browser.newPage();
      await page.goto(
        pathToFileURL(path.join(verdictDirectory, report.file)).href,
        { waitUntil: 'load' }
      );
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        tagged: true
      });
      assert.match(pdf.subarray(0, 8).toString('ascii'), /^%PDF-/);
      assert.ok(pdf.length > 10_000, `${verdict}:${report.page}:pdf-size`);
      const structure = pdfFacts(pdf);
      const destination = artifactPath(
        `${verdict}-${report.page}-print.pdf`,
        {
          kind: 'print-pdf',
          verdict,
          page: report.page,
          ...structure
        }
      );
      if (destination) fs.writeFileSync(destination, pdf, { flag: 'wx' });
      const text = pdfText(pdf);
      const expected = verdict === 'blocked'
        ? ['BLOCKED', 'verification-runtime:not-ready', 'runtime-status.json']
        : report.page === 'overview'
          ? ['PASS', 'snapshot-001', 'evidence-001']
          : report.page === 'catalog'
            ? ['PASS', 'case-minimal', 'Validate the V2 contract']
            : ['PASS', 'case-minimal', 'evidence-facticity'];
      for (const fact of expected) {
        assert.match(
          text,
          new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${verdict}:${report.page}:print:${fact}`
        );
      }
      await page.close();
    }
  }
});
