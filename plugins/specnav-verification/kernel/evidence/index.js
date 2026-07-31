'use strict';

const {
  createEvidenceStore
} = require('./evidence-store');
const {
  createEvidenceIntegrityChecker
} = require('./integrity-checker');
const {
  createSecretRedactor
} = require('./secret-redactor');
const {
  createCaseFreshnessEvaluator
} = require('./case-freshness');

module.exports = {
  createEvidenceStore,
  createEvidenceIntegrityChecker,
  createSecretRedactor,
  createCaseFreshnessEvaluator
};
