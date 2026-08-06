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
  labelForStatus,
  renderBlockers,
  renderDomainTable,
  renderMetric,
  renderRepairTimeline,
  renderReferenceList,
  statusBadge,
  statusClass
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

function blocker(id, detail = null) {
  return Object.freeze({
    id,
    artifact: 'overview.html',
    detail
  });
}

function invalid(blockers) {
  return deepFreeze({
    ok: false,
    file_name: 'overview.html',
    html: null,
    blockers
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

function releaseCopy(verdict) {
  const copy = {
    green: 'All trusted verification facts satisfy the current release gate.',
    red: 'At least one current case reading fails the release gate.',
    blocked: 'Required verification facts are missing or cannot be trusted.',
    running: 'Verification is still executing; no terminal release claim is available.',
    canceled: 'The active verification run was canceled before a terminal decision.',
    stale: 'Evidence no longer matches the current execution fingerprint.',
    flaky: 'A retry passed after an earlier failure; the unstable history remains visible.',
    pass_after_fix: 'The repaired case passed retest and required regression with history preserved.'
  };
  return copy[verdict];
}

function renderOverviewBody(model, safe) {
  const summary = model.summary;
  const totals = summary.totals;
  const empty = totals.cases === 0 ? 'empty' : 'populated';
  const verdictCopy = releaseCopy(model.verdict);
  const changeId = safe.text(model.change_id, 'change_id');
  const lifecycle = safe.text(
    labelForStatus(summary.lifecycle_status),
    'lifecycle_status'
  );
  const freshnessChecked = safe.text(
    summary.freshness.checked_at,
    'freshness_checked_at'
  );
  const repairStatus = safe.text(
    labelForStatus(summary.repair_loop.status),
    'repair_loop_status'
  );
  const freshnessReasons = safe.text(
    summary.freshness.reasons.join(', ') || 'none',
    'freshness_reasons'
  );
  const failureIds = safe.text(
    summary.repair_loop.failure_ids.join(', ') || 'none',
    'repair_failure_ids'
  );
  const repairIds = safe.text(
    summary.repair_loop.repair_ids.join(', ') || 'none',
    'repair_ids'
  );
  const verdictDescription = safe.text(verdictCopy, 'verdict_description');
  if (
    [
      changeId,
      lifecycle,
      freshnessChecked,
      freshnessReasons,
      failureIds,
      repairIds,
      repairStatus,
      verdictDescription
    ].includes(null)
  ) {
    return null;
  }
  const blockers = renderBlockers(model.blockers, safe);
  const warnings = renderBlockers(
    model.warnings,
    safe,
    'No report warnings are recorded in the validated report model.'
  );
  const references = renderReferenceList(model.sources, safe);
  if ([blockers, warnings, references].includes(null)) return null;
  const emptyState = totals.cases === 0
    ? `<section class="state-message state-empty" role="status">
        <strong>No approved test cases are present in this report model.</strong>
        <span>Case execution remains blocked until the current case snapshot is approved and the report model is rebuilt.</span>
      </section>`
    : '';

  return `      <article class="overview" data-report-verdict="${model.verdict}" data-report-state="${empty}">
        <section class="verdict-band ${statusClass(model.verdict)}" data-report-section="release-verdict">
          <div>
            <p class="eyebrow">Release decision</p>
            <h1>${statusBadge(model.verdict)} Verification for <code>${changeId}</code></h1>
            <p>${verdictDescription}</p>
          </div>
          <dl class="verdict-meta">
            <div><dt>Lifecycle</dt><dd>${lifecycle}</dd></div>
            <div><dt>Open blockers</dt><dd>${model.blockers.length}</dd></div>
          </dl>
        </section>
${emptyState}

        <section class="section lifecycle-section" data-report-section="lifecycle">
          <div class="section-heading">
            <div><p class="eyebrow">Readiness</p><h2>Lifecycle status</h2></div>
            ${statusBadge(summary.lifecycle_status)}
          </div>
          <p>Lifecycle readiness is derived from the current run history and gate decision.</p>
        </section>

        <section class="metrics" aria-label="Verification totals" data-report-section="metrics">
          ${renderMetric('Approved cases', totals.cases, 'validated case snapshot')}
          ${renderMetric('Runs', totals.runs, 'immutable execution batches')}
          ${renderMetric('Attempts', totals.attempts, 'initial, retry, retest, regression')}
          ${renderMetric('Evidence', totals.evidence, `${totals.readings} readings`)}
          ${renderMetric('Failures', totals.failures, `${summary.open_failure_ids.length} open`)}
          ${renderMetric('Repairs', totals.repairs, `${summary.open_repair_ids.length} open`)}
        </section>

        <section class="section" data-report-section="six-domains">
          <div class="section-heading">
            <div><p class="eyebrow">Coverage</p><h2>Six-domain status</h2></div>
          </div>
          ${renderDomainTable(summary.domains)}
        </section>

        <section class="section" data-report-section="blockers">
          <div class="section-heading">
            <div><p class="eyebrow">Required action</p><h2>Release blockers</h2></div>
            <span class="count">${model.blockers.length}</span>
          </div>
          ${blockers}
          <h3>Report warnings</h3>
          ${warnings}
        </section>

        <section class="section" data-report-section="freshness-integrity">
          <div class="section-heading">
            <div><p class="eyebrow">Evidence health</p><h2>Freshness and integrity</h2></div>
          </div>
          <dl class="health-grid">
            <div><dt>Freshness</dt><dd>${statusBadge(summary.freshness.status)}</dd><small>Checked ${freshnessChecked}</small></div>
            <div><dt>Integrity</dt><dd>${statusBadge(summary.integrity)}</dd><small>Evidence Index authority result</small></div>
          </dl>
          <p class="health-reasons"><strong>Freshness reasons:</strong> <code>${freshnessReasons}</code></p>
        </section>

        <section class="section" data-report-section="repair-loop">
          <div class="section-heading">
            <div><p class="eyebrow">Failure lifecycle</p><h2>Repair loop</h2></div>
            ${statusBadge(summary.repair_loop.status)}
          </div>
          <dl class="repair-grid">
            <div><dt>Status</dt><dd>${repairStatus}</dd></div>
            <div><dt>Failures</dt><dd>${summary.repair_loop.failure_ids.length}</dd></div>
            <div><dt>Repairs</dt><dd>${summary.repair_loop.repair_ids.length}</dd></div>
            <div><dt>History events</dt><dd>${summary.repair_loop.history_event_count}</dd></div>
          </dl>
          <dl class="repair-references">
            <div><dt>Failure IDs</dt><dd><code>${failureIds}</code></dd></div>
            <div><dt>Repair IDs</dt><dd><code>${repairIds}</code></dd></div>
          </dl>
          ${renderRepairTimeline(summary)}
        </section>

        <section class="section" data-report-section="sources">
          <div class="section-heading">
            <div><p class="eyebrow">Authority</p><h2>Source references</h2></div>
          </div>
          ${references}
          <p class="projection-notice"><strong>Projection boundary:</strong> release and archive gates read validated JSON and JSONL artifacts, never this HTML file.</p>
        </section>
      </article>`;
}

function createOverviewRenderer(options) {
  assertConfig(options);
  const {
    schemaRegistry,
    secretRedactor
  } = options;
  const stylesheet = loadReportStylesheet();

  function render(candidate) {
    const validation = schemaRegistry.validate('report-model', candidate, {
      artifactPath: 'memory://overview-report-model'
    });
    if (!validation.ok) {
      return invalid([
        blocker(
          'verification-report-renderer:model-invalid',
          JSON.stringify(validation.blockers)
        )
      ]);
    }
    const model = validation.value;
    const safe = createSafeRenderer(secretRedactor);
    const body = renderOverviewBody(model, safe);
    if (body === null || safe.blockers.length > 0) {
      return invalid([
        blocker(
          'verification-report-renderer:redaction-failed',
          JSON.stringify(safe.blockers)
        )
      ]);
    }
    const html = renderReportShell({
      activePage: 'overview',
      body,
      model,
      safe,
      stylesheet,
      title: `SpecNav Verification 2.0 - ${labelForStatus(model.verdict)}`
    });
    if (html === null || safe.blockers.length > 0) {
      return invalid([
        blocker(
          'verification-report-renderer:shell-failed',
          JSON.stringify(safe.blockers)
        )
      ]);
    }
    return deepFreeze({
      ok: true,
      file_name: 'overview.html',
      html,
      blockers: []
    });
  }

  return Object.freeze({ render });
}

module.exports = {
  createOverviewRenderer
};
