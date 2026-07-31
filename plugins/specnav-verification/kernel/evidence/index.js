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

module.exports = {
  createEvidenceStore,
  createEvidenceIntegrityChecker,
  createSecretRedactor
};
