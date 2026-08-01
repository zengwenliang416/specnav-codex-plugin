'use strict';

const {
  escapeHtml,
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

module.exports = {
  createEvidenceIndexAuthority,
  createReportFactAuthority,
  createReportModelBuilder,
  escapeHtml,
  renderSafeHtmlText,
  resolveEvidenceLinks
};
