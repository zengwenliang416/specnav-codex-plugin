'use strict';

const {
  renderSafeHtmlAttribute,
  renderSafeHtmlText
} = require('./safe-html-text');
const {
  contentSecurityPolicy,
  renderInlineScripts,
  resolveReportScripts,
  validateReportBody,
  validateReportStylesheet
} = require('./report-security');

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
    reject(value) {
      blockers.push(value);
      return null;
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
    scriptIds = [],
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
  const generatedAtAttribute = safe.attribute(
    model.generated_at,
    'generated_at_attribute'
  );
  const renderedTitle = safe.text(title, 'report_title');
  if ([
    modelId,
    changeId,
    generatedAt,
    generatedAtAttribute,
    renderedTitle,
    runtimeVersion,
    kernelVersion
  ].includes(null)) {
    return null;
  }
  const resolvedScripts = resolveReportScripts(scriptIds);
  if (!resolvedScripts.ok) {
    safe.reject(resolvedScripts.blockers[0]);
    return null;
  }
  const bodyValidation = validateReportBody(body);
  if (!bodyValidation.ok) {
    safe.reject(bodyValidation.blocker);
    return null;
  }
  const stylesheetValidation = validateReportStylesheet(stylesheet);
  if (!stylesheetValidation.ok) {
    safe.reject(stylesheetValidation.blocker);
    return null;
  }
  const securityPolicy = contentSecurityPolicy(resolvedScripts.scripts);
  const inlineScripts = renderInlineScripts(resolvedScripts.scripts);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="${securityPolicy}">
  <title>${renderedTitle}</title>
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
    <main id="report-content" tabindex="-1">
${body}
    </main>
    <footer class="report-footer">
      <span>Generated <time datetime="${generatedAtAttribute}">${generatedAt}</time> from validated Verification 2.0 artifacts.</span>
      <strong>HTML is a projection, not the gate source of truth.</strong>
    </footer>
  </div>
${inlineScripts}
</body>
</html>`;
}

module.exports = {
  REPORT_PAGES,
  createSafeRenderer,
  renderNavigation,
  renderReportShell
};
