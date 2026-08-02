'use strict';

const {
  escapeHtml,
  renderSafeHtmlAttribute,
  renderSafeHtmlText
} = require('./safe-html-text');
const {
  createReportModelBuilder
} = require('./report-model-builder');
const {
  resolveEvidenceLinks
} = require('./evidence-link-resolver');
const {
  createEvidenceIndexAuthority,
  createReportFactAuthority
} = require('./report-authorities');
const {
  createOverviewRenderer
} = require('./overview-renderer');
const {
  createCaseCatalogRenderer,
  createCaseResultsRenderer
} = require('./case-page-renderers');

module.exports = {
  createCaseCatalogRenderer,
  createCaseResultsRenderer,
  createEvidenceIndexAuthority,
  createOverviewRenderer,
  createReportFactAuthority,
  createReportModelBuilder,
  escapeHtml,
  renderSafeHtmlAttribute,
  renderSafeHtmlText,
  resolveEvidenceLinks
};
