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
const {
  codeInventory,
  codeInventorySha
} = require('./repository-fingerprint');

module.exports = {
  createEvidenceStore,
  createEvidenceIntegrityChecker,
  createSecretRedactor,
  createCaseFreshnessEvaluator,
  codeInventory,
  codeInventorySha
};
