'use strict';

const {
  renderSafeHtmlAttribute,
  renderSafeHtmlText
} = require('./safe-html-text');

const REPORT_PAGES = Object.freeze([
  Object.freeze({
    id: 'overview',
    href: 'overview.html',
    label: 'Overview'
  }),
  Object.freeze({
    id: 'catalog',
    href: 'test-case-catalog.html',
    label: 'Test case catalog'
  }),
  Object.freeze({
    id: 'results',
    href: 'test-case-results.html',
    label: 'Case results'
  })
]);

function createSafeRenderer(secretRedactor) {
  const blockers = [];

  function render(method, value, field) {
    const result = method(secretRedactor, String(value), { field });
    if (result.ok !== true) {
      blockers.push(...(result.blockers || []));
      return null;
    }
    return result.html;
  }

  return Object.freeze({
    attribute(value, field = 'html_attribute') {
      return render(renderSafeHtmlAttribute, value, field);
    },
    text(value, field = 'html_text') {
      return render(renderSafeHtmlText, value, field);
    },
    blockers
  });
}

function renderNavigation(activePage) {
  return REPORT_PAGES.map((page) => {
    const current = page.id === activePage ? ' aria-current="page"' : '';
    return `<a href="${page.href}"${current}>${page.label}</a>`;
  }).join('');
}

function renderReportShell(options) {
  const {
    activePage,
    body,
    model,
    safe,
    stylesheet,
    title
  } = options;
  const modelId = safe.attribute(model.id, 'report_model_id');
  const changeId = safe.text(model.change_id, 'change_id');
  const generatedAt = safe.text(model.generated_at, 'generated_at');
  const runtimeVersion = safe.text(
    model.summary.runtime_version || 'not ready',
    'runtime_version'
  );
  const kernelVersion = safe.text(
    model.summary.kernel_version || 'unknown',
    'kernel_version'
  );
  if ([modelId, changeId, generatedAt, runtimeVersion, kernelVersion].includes(null)) {
    return null;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${title}</title>
  <style data-specnav-report-styles>
${stylesheet}
  </style>
</head>
<body>
  <a class="skip-link" href="#report-content">Skip to report content</a>
  <div class="report-shell" data-report-model-id="${modelId}">
    <header class="report-header">
      <a class="brand" href="overview.html" aria-label="SpecNav verification overview">
        <span class="brand-mark" aria-hidden="true">S</span>
        <span><strong>SpecNav</strong><small>Verification 2.0</small></span>
      </a>
      <dl class="run-meta">
        <div><dt>Change</dt><dd><code>${changeId}</code></dd></div>
        <div><dt>Runtime</dt><dd><code>${runtimeVersion}</code></dd></div>
        <div><dt>Kernel</dt><dd><code>${kernelVersion}</code></dd></div>
      </dl>
    </header>
    <nav class="report-navigation" aria-label="Verification reports">
      ${renderNavigation(activePage)}
    </nav>
    <main id="report-content">
${body}
    </main>
    <footer class="report-footer">
      <span>Generated <time>${generatedAt}</time> from validated Verification 2.0 artifacts.</span>
      <strong>HTML is a projection, not the gate source of truth.</strong>
    </footer>
  </div>
</body>
</html>`;
}

module.exports = {
  REPORT_PAGES,
  createSafeRenderer,
  renderNavigation,
  renderReportShell
};
