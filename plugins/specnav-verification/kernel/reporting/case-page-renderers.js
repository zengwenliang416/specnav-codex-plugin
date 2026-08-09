'use strict';

const {
  isSecretRedactor
} = require('../evidence/secret-redactor');
const {
  isSchemaRegistry
} = require('../contracts/schema-registry');
const {
  loadReportStylesheet
} = require('./report-assets');
const {
  DOMAIN_LABELS,
  labelForStatus,
  renderBlockers,
  renderThreeLineTable,
  statusBadge
} = require('./report-components');
const {
  createSafeRenderer,
  renderReportShell
} = require('./report-shell');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function invalid(fileName, id, detail = null) {
  return deepFreeze({
    ok: false,
    file_name: fileName,
    html: null,
    blockers: [{ id, artifact: fileName, detail }]
  });
}

function assertConfig(options) {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isSchemaRegistry(options.schemaRegistry)
    || !isSecretRedactor(options.secretRedactor)
  ) {
    throw new Error('verification-report-renderer:config-invalid');
  }
}

function safeJoin(values, safe, field, empty = 'none') {
  return safe.text(values.length ? values.join(', ') : empty, field);
}

function renderCatalogCase(testCase, safe) {
  const id = safe.text(testCase.id, 'case_id');
  const title = safe.text(testCase.title, 'case_title');
  const goal = safe.text(testCase.goal, 'case_goal');
  const actor = safe.text(testCase.actor, 'case_actor');
  const priority = safe.text(testCase.priority, 'case_priority');
  const runner = safe.text(testCase.runner.kind, 'case_runner');
  const search = safe.attribute(
    `${testCase.id} ${testCase.title} ${testCase.goal}`.toLowerCase(),
    'case_search'
  );
  const evidence = safeJoin(
    testCase.evidence_policy.required_kinds,
    safe,
    'case_evidence'
  );
  if ([id, title, goal, actor, priority, runner, search, evidence].includes(null)) {
    return null;
  }
  const domains = Object.entries(testCase.domains).map(([domain, config]) => {
    const mode = safe.text(config.mode, `case_domain_${domain}_mode`);
    if (mode === null) return null;
    return `<span class="domain-label" data-domain="${domain}">${DOMAIN_LABELS[domain]}: ${mode}</span>`;
  });
  const steps = testCase.steps.map((step) => {
    const stepId = safe.text(step.id, 'case_step_id');
    const action = safe.text(step.action, 'case_step_action');
    const expected = safe.text(step.expected, 'case_step_expected');
    if ([stepId, action, expected].includes(null)) return null;
    return `<li><code>${stepId}</code><span>${action}</span><small>Expected: ${expected}</small></li>`;
  });
  const assertions = testCase.assertions.map((assertion) => {
    const assertionId = safe.text(assertion.id, 'case_assertion_id');
    const statement = safe.text(assertion.statement, 'case_assertion_statement');
    const oracle = safe.text(assertion.oracle.type, 'case_assertion_oracle');
    if ([assertionId, statement, oracle].includes(null)) return null;
    return `<li><code>${assertionId}</code><span>${statement}</span><small>Oracle: ${oracle}</small></li>`;
  });
  if ([domains, steps, assertions].some((items) => items.includes(null))) return null;
  return `<article class="case-contract" data-case-row data-search="${search}" data-priority="${priority}">
    <header><div><p class="eyebrow">${priority} · ${actor}</p><h2><code>${id}</code> ${title}</h2><p>${goal}</p></div>${statusBadge(testCase.status)}</header>
    <dl class="contract-meta">
      <div><dt>Runner</dt><dd><code>${runner}</code></dd></div>
      <div><dt>Required evidence</dt><dd><code>${evidence}</code></dd></div>
    </dl>
    <div class="domain-labels">${domains.join('')}</div>
    <div class="contract-columns">
      <section><h3>Steps</h3><ol class="contract-list">${steps.join('')}</ol></section>
      <section><h3>Assertions</h3><ol class="contract-list">${assertions.join('')}</ol></section>
    </div>
  </article>`;
}

function renderCatalogBody(model, safe) {
  const cases = model.catalog.map((entry) => renderCatalogCase(entry, safe));
  const blockers = renderBlockers(model.blockers, safe);
  if (cases.includes(null) || blockers === null) return null;
  const content = cases.length
    ? cases.join('')
    : '<p class="state-message state-empty">No approved test cases are present in this report model.</p>';
  return `<article class="case-page" data-report-page="catalog">
    <section class="page-heading" data-report-section="case-contracts">
      <div><p class="eyebrow">Approved contract</p><h1>Test case catalog</h1><p>${model.catalog.length} approved behavior contract(s).</p></div>
      ${statusBadge(model.verdict)}
    </section>
    <form class="filter-bar" data-report-component="case-filter" role="search">
      <label>Search cases<input type="search" aria-label="Search cases"></label>
      <label>Priority<select aria-label="Filter by priority"><option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option></select></label>
    </form>
    <section class="case-contracts">${content}</section>
    <section class="section" data-report-section="blockers"><h2>Report blockers</h2>${blockers}</section>
  </article>`;
}

function renderEvidence(entry, safe) {
  const id = safe.text(entry.id, 'evidence_id');
  const kind = safe.text(entry.kind, 'evidence_kind');
  const path = safe.text(entry.path || 'unavailable', 'evidence_path');
  const hash = safe.text(entry.sha256, 'evidence_sha256');
  const producer = safe.text(entry.producer, 'evidence_producer');
  const href = entry.available && entry.href
    ? safe.attribute(entry.href, 'evidence_href')
    : null;
  if ([id, kind, path, hash, producer].includes(null)) return null;
  const identity = href
    ? `<a href="${href}"><code>${id}</code></a>`
    : `<code>${id}</code>`;
  return `<article class="evidence-item">
    <header>${identity}${statusBadge(entry.integrity)}</header>
    <dl>
      <div><dt>Kind</dt><dd><code>${kind}</code></dd></div>
      <div><dt>Path</dt><dd><code>${path}</code></dd></div>
      <div><dt>SHA-256</dt><dd><code>${hash}</code></dd></div>
      <div><dt>Freshness</dt><dd>${statusBadge(entry.freshness)}</dd></div>
      <div><dt>Producer</dt><dd><code>${producer}</code></dd></div>
    </dl>
  </article>`;
}

function renderResult(result, safe, tableNumber) {
  const caseId = safe.text(result.case_id, 'result_case_id');
  const command = safe.text(
    [result.command.entrypoint, ...result.command.args].filter(Boolean).join(' '),
    'result_command'
  );
  if ([caseId, command].includes(null)) return null;
  const runs = result.runs.map((run) => {
    const id = safe.text(run.id, 'run_id');
    const codeSha = safe.text(run.code_sha, 'run_code_sha');
    const testSha = safe.text(run.test_sha, 'run_test_sha');
    if ([id, codeSha, testSha].includes(null)) return null;
    return `<li><code>${id}</code>${statusBadge(run.status)}<small>code ${codeSha} · tests ${testSha}</small></li>`;
  });
  const attempts = result.attempts.map((attempt) => {
    const id = safe.text(attempt.id, 'attempt_id');
    const kind = safe.text(attempt.kind, 'attempt_kind');
    if ([id, kind].includes(null)) return null;
    return `<li><code>${id}</code><span>${kind}</span>${statusBadge(attempt.status)}</li>`;
  });
  const readings = result.readings.map((reading) => {
    const id = safe.text(reading.id, 'reading_id');
    const expected = safe.text(JSON.stringify(reading.expected), 'reading_expected');
    const actual = safe.text(JSON.stringify(reading.actual), 'reading_actual');
    const oracle = safe.text(reading.oracle.type, 'reading_oracle');
    if ([id, expected, actual, oracle].includes(null)) return null;
    return `<tr><th scope="row"><code>${id}</code></th><td>${DOMAIN_LABELS[reading.domain]}</td><td><code>${expected}</code></td><td><code>${actual}</code></td><td><code>${oracle}</code></td><td>${statusBadge(reading.verdict)}</td></tr>`;
  });
  const evidence = result.evidence.map((entry) => renderEvidence(entry, safe));
  const blockers = renderBlockers(result.blockers, safe);
  if ([runs, attempts, readings, evidence].some((items) => items.includes(null)) || blockers === null) {
    return null;
  }
  const readingsTable = renderThreeLineTable({
    ariaLabel: `Readings for case ${caseId}`,
    caption: `Table ${tableNumber}. Readings for case ${caseId}`,
    columns: ['Reading', 'Domain', 'Expected', 'Actual', 'Oracle', 'Verdict'],
    note: 'Expected values, actual values, oracle identities, and verdicts are projected from immutable reading artifacts.',
    rows: readings.join('')
  });
  return `<section class="case-result" id="result-${caseId}" data-case-result>
    <header><div><p class="eyebrow">Case result</p><h2><code>${caseId}</code></h2><p><code>${command}</code></p></div>${statusBadge(result.status)}</header>
    <div class="result-summary"><span>Freshness ${statusBadge(result.freshness)}</span><span>${result.failures.length} failure(s)</span><span>${result.repairs.length} repair(s)</span></div>
    <section><h3>Runs</h3><ol class="history-list">${runs.join('')}</ol></section>
    <section><h3>Attempts</h3><ol class="history-list">${attempts.join('')}</ol></section>
    <section><h3>Readings</h3>${readingsTable}</section>
    <section><h3>Evidence</h3><div class="evidence-grid">${evidence.join('')}</div></section>
    <section><h3>Case blockers</h3>${blockers}</section>
  </section>`;
}

function renderResultsBody(model, safe) {
  const results = model.results.map((entry, index) => renderResult(entry, safe, index + 1));
  const index = model.results.map((entry) => {
    const id = safe.text(entry.case_id, 'result_index_case_id');
    const target = safe.attribute(`result-${entry.case_id}`, 'result_index_target');
    if ([id, target].includes(null)) return null;
    return `<a href="#${target}"><code>${id}</code> ${labelForStatus(entry.status)}</a>`;
  });
  const blockers = renderBlockers(model.blockers, safe);
  if (results.includes(null) || index.includes(null) || blockers === null) return null;
  const content = results.length
    ? results.join('')
    : '<p class="state-message state-empty">No immutable case results are present in this report model.</p>';
  return `<article class="case-page" data-report-page="results">
    <section class="page-heading" data-report-section="case-results">
      <div><p class="eyebrow">Immutable execution history</p><h1>Test case results</h1><p>Retry, repair, retest, and regression facts remain visible.</p></div>
      ${statusBadge(model.verdict)}
    </section>
    <nav class="case-index" aria-label="Case results">${index.join('')}</nav>
    <div class="case-results">${content}</div>
    <section class="section" data-report-section="blockers"><h2>Report blockers</h2>${blockers}</section>
  </article>`;
}

function createRenderer(options, page) {
  assertConfig(options);
  const stylesheet = loadReportStylesheet();
  const fileName = page === 'catalog'
    ? 'test-case-catalog.html'
    : 'test-case-results.html';
  return Object.freeze({
    render(candidate) {
      const validation = options.schemaRegistry.validate('report-model', candidate, {
        artifactPath: `memory://${page}-report-model`
      });
      if (!validation.ok) {
        return invalid(
          fileName,
          'verification-report-renderer:model-invalid',
          JSON.stringify(validation.blockers)
        );
      }
      const safe = createSafeRenderer(options.secretRedactor);
      const body = page === 'catalog'
        ? renderCatalogBody(validation.value, safe)
        : renderResultsBody(validation.value, safe);
      if (body === null || safe.blockers.length) {
        return invalid(
          fileName,
          'verification-report-renderer:redaction-failed',
          JSON.stringify(safe.blockers)
        );
      }
      const html = renderReportShell({
        activePage: page,
        body,
        model: validation.value,
        safe,
        scriptIds: page === 'catalog' ? ['catalog-filter'] : [],
        stylesheet,
        title: `SpecNav Verification 2.0 - ${page === 'catalog' ? 'Test case catalog' : 'Case results'}`
      });
      if (html === null || safe.blockers.length) {
        return invalid(
          fileName,
          'verification-report-renderer:shell-failed',
          JSON.stringify(safe.blockers)
        );
      }
      return deepFreeze({ ok: true, file_name: fileName, html, blockers: [] });
    }
  });
}

function createCaseCatalogRenderer(options) {
  return createRenderer(options, 'catalog');
}

function createCaseResultsRenderer(options) {
  return createRenderer(options, 'results');
}

module.exports = {
  createCaseCatalogRenderer,
  createCaseResultsRenderer
};
