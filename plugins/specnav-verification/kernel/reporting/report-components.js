'use strict';

const DOMAIN_LABELS = Object.freeze({
  facticity: 'Facticity',
  static: 'Static',
  unit: 'Unit',
  redteam: 'Red team',
  e2e: 'E2E',
  sensory: 'Sensory'
});

const STATUS_META = Object.freeze({
  green: Object.freeze({ label: 'PASS', icon: '\u2713' }),
  red: Object.freeze({ label: 'FAIL', icon: '\u00d7' }),
  blocked: Object.freeze({ label: 'BLOCKED', icon: '!' }),
  running: Object.freeze({ label: 'RUNNING', icon: '\u2026' }),
  canceled: Object.freeze({ label: 'CANCELED', icon: '\u2212' }),
  stale: Object.freeze({ label: 'STALE', icon: '!' }),
  flaky: Object.freeze({ label: 'FLAKY', icon: '~' }),
  pass_after_fix: Object.freeze({ label: 'PASS AFTER FIX', icon: '\u2713' }),
  pass: Object.freeze({ label: 'PASS', icon: '\u2713' }),
  fail: Object.freeze({ label: 'FAIL', icon: '\u00d7' }),
  passed: Object.freeze({ label: 'PASSED', icon: '\u2713' }),
  failed: Object.freeze({ label: 'FAILED', icon: '\u00d7' }),
  ready: Object.freeze({ label: 'READY', icon: '\u2713' }),
  not_applicable: Object.freeze({ label: 'NOT APPLICABLE', icon: '\u2212' }),
  planned: Object.freeze({ label: 'PLANNED', icon: '!' }),
  terminal: Object.freeze({ label: 'TERMINAL', icon: '\u2713' }),
  released: Object.freeze({ label: 'RELEASED', icon: '\u2713' }),
  archived: Object.freeze({ label: 'ARCHIVED', icon: '\u2713' }),
  intact: Object.freeze({ label: 'INTACT', icon: '\u2713' }),
  broken: Object.freeze({ label: 'BROKEN', icon: '\u00d7' }),
  unknown: Object.freeze({ label: 'UNKNOWN', icon: '!' }),
  fresh: Object.freeze({ label: 'FRESH', icon: '\u2713' }),
  not_started: Object.freeze({ label: 'NOT STARTED', icon: '\u2212' }),
  open: Object.freeze({ label: 'OPEN', icon: '\u00d7' }),
  repairing: Object.freeze({ label: 'REPAIRING', icon: '\u2026' }),
  retesting: Object.freeze({ label: 'RETESTING', icon: '\u2026' }),
  regressing: Object.freeze({ label: 'REGRESSING', icon: '\u2026' }),
  closed: Object.freeze({ label: 'CLOSED', icon: '\u2713' }),
  break_loop: Object.freeze({ label: 'BREAK LOOP', icon: '!' })
});

function labelForStatus(status) {
  const meta = STATUS_META[status];
  if (!meta) throw new Error('verification-report-renderer:status-invalid');
  return meta.label;
}

function statusClass(status) {
  if (!STATUS_META[status]) {
    throw new Error('verification-report-renderer:status-invalid');
  }
  return `status-${String(status).replaceAll('_', '-')}`;
}

function statusBadge(status) {
  const meta = STATUS_META[status];
  if (!meta) throw new Error('verification-report-renderer:status-invalid');
  return `<span class="status-badge ${statusClass(status)}"><span class="status-icon" aria-hidden="true">${meta.icon}</span>${meta.label}</span>`;
}

function renderMetric(label, value, detail = '') {
  return `<div class="metric">
    <span>${label}</span>
    <strong>${value}</strong>
    <small>${detail}</small>
  </div>`;
}

function renderThreeLineTable({
  ariaLabel,
  caption,
  columns,
  note,
  rows,
  tableClass = ''
}) {
  const className = ['three-line-table', tableClass].filter(Boolean).join(' ');
  return `<div class="table-block">
    <div class="table-scroll" role="region" aria-label="${ariaLabel}" tabindex="0">
      <table class="${className}">
        <caption>${caption}</caption>
        <thead><tr>${columns.map((column) => `<th scope="col">${column}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="table-note"><strong>Note.</strong> ${note}</p>
  </div>`;
}

function renderDomainTable(domains) {
  const rows = Object.entries(DOMAIN_LABELS).map(([domain, label]) => {
    const status = domains[domain];
    return `<tr data-domain="${domain}">
      <th scope="row">${label}</th>
      <td>${statusBadge(status)}</td>
      <td>${labelForStatus(status)} result derived from current case readings.</td>
    </tr>`;
  }).join('');
  return renderThreeLineTable({
    ariaLabel: 'Six-domain verification status table',
    caption: 'Table 1. Six-domain verification status',
    columns: ['Domain', 'Status', 'Authority'],
    note: 'Domain status is derived from validated readings in the current report model.',
    rows,
    tableClass: 'domain-table'
  });
}

function renderBlockers(blockers, safe, emptyMessage = (
  'No active blockers are recorded in the validated report model.'
)) {
  if (blockers.length === 0) {
    return `<p class="empty-message">${emptyMessage}</p>`;
  }
  const rows = blockers.map((entry) => {
    const id = safe.text(entry.id, 'blocker_id');
    const artifact = safe.text(entry.artifact || 'not specified', 'blocker_artifact');
    const detail = safe.text(entry.detail || 'No detail supplied.', 'blocker_detail');
    if ([id, artifact, detail].includes(null)) return null;
    const nextAction = nextActionForBlocker(entry.id, id, artifact);
    return `<li>
      <strong><code>${id}</code></strong>
      <span>${detail}</span>
      <small>Artifact: <code>${artifact}</code></small>
      <span class="next-action"><strong>Next action:</strong> ${nextAction}</span>
    </li>`;
  });
  if (rows.includes(null)) return null;
  return `<ol class="blocker-list">${rows.join('')}</ol>`;
}

function nextActionForBlocker(blockerId, renderedId, renderedArtifact) {
  if (blockerId === 'verification-runtime:not-ready') {
    return 'Run <code>specnav-verification-runtime-status</code>; request <code>specnav-verification-runtime-setup</code> only when installation or repair is required.';
  }
  if (/evidence.*(?:missing|unavailable)|missing.*evidence/i.test(blockerId)) {
    return `Restore or regenerate <code>${renderedArtifact}</code>, rebuild the Evidence Index, and rerun the affected cases.`;
  }
  if (/regression.*(?:not-run|missing)|missing.*regression/i.test(blockerId)) {
    return `Execute the approved regression scope for <code>${renderedArtifact}</code>, then rebuild the validated report model.`;
  }
  return `Resolve <code>${renderedId}</code> for <code>${renderedArtifact}</code> in the source artifacts, then rebuild the validated report model.`;
}

function renderRepairTimeline(summary) {
  const repair = summary.repair_loop;
  const stages = [
    ['initial', 'Initial attempt', summary.totals.attempts > 0 ? 'terminal' : 'not_started'],
    ['failure', 'Failure classified', summary.totals.failures > 0
      ? summary.open_failure_ids.length > 0 ? 'open' : 'closed'
      : 'not_started'],
    ['repair', 'Repair reviewed', summary.totals.repairs > 0
      ? ['open', 'repairing'].includes(repair.status) ? repair.status : 'closed'
      : 'not_started'],
    ['retest', 'Retest', ['retesting', 'regressing', 'closed'].includes(repair.status)
      ? repair.status === 'retesting' ? 'running' : 'terminal'
      : 'not_started'],
    ['regression', 'Regression', repair.status === 'regressing'
      ? 'running'
      : repair.status === 'closed' && summary.totals.repairs > 0
        ? 'terminal'
        : 'not_started']
  ];
  return `<ol class="repair-timeline">${stages.map(([id, label, status]) => (
    `<li data-repair-stage="${id}"><span>${label}</span>${statusBadge(status)}</li>`
  )).join('')}</ol>`;
}

function renderReferenceList(sources, safe) {
  const references = [
    ['Case snapshot', sources.case_snapshot_id],
    ['Snapshot SHA-256', sources.case_snapshot_hash],
    ['Evidence index version', sources.evidence_index_version],
    ['Evidence index SHA-256', sources.evidence_index_digest],
    ['Aggregate', sources.aggregate_id],
    ['Gate decision', sources.gate_decision_id],
    ['Runs', sources.run_ids.join(', ') || 'none'],
    ['Attempts', sources.attempt_ids.join(', ') || 'none'],
    ['Readings', sources.reading_ids.join(', ') || 'none'],
    ['Evidence', sources.evidence_ids.join(', ') || 'none']
  ];
  const rows = references.map(([label, value]) => {
    const rendered = safe.text(
      value === null ? 'not available' : String(value),
      `source_${label.toLowerCase().replaceAll(' ', '_')}`
    );
    if (rendered === null) return null;
    return `<div><dt>${label}</dt><dd><code>${rendered}</code></dd></div>`;
  });
  if (rows.includes(null)) return null;
  return `<dl class="source-list">${rows.join('')}</dl>`;
}

module.exports = {
  DOMAIN_LABELS,
  STATUS_META,
  labelForStatus,
  renderBlockers,
  renderDomainTable,
  renderMetric,
  renderRepairTimeline,
  renderReferenceList,
  renderThreeLineTable,
  statusBadge,
  statusClass
};
