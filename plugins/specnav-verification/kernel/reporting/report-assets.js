'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPORT_STYLESHEET_PATH = path.resolve(
  __dirname,
  '../../assets/report/report.css'
);

let cachedStylesheet = null;

function loadReportStylesheet() {
  if (cachedStylesheet !== null) return cachedStylesheet;
  const stylesheet = fs.readFileSync(REPORT_STYLESHEET_PATH, 'utf8');
  if (stylesheet.trim().length === 0) {
    throw new Error('verification-report-renderer:stylesheet-empty');
  }
  cachedStylesheet = stylesheet;
  return cachedStylesheet;
}

module.exports = {
  REPORT_STYLESHEET_PATH,
  loadReportStylesheet
};
