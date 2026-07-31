'use strict';

const {
  createEvidenceStore
} = require('./evidence-store');
const {
  createEvidenceIntegrityChecker
} = require('./integrity-checker');

module.exports = {
  createEvidenceStore,
  createEvidenceIntegrityChecker
};
