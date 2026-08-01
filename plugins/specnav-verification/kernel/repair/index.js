'use strict';

const {
  ALL_DOMAINS,
  createCaseRerunPlanner
} = require('./case-rerun-planner');
const {
  CLASSIFICATION_POLICY,
  createFailureClassifier
} = require('./failure-classifier');

module.exports = Object.freeze({
  ALL_DOMAINS,
  CLASSIFICATION_POLICY,
  createFailureClassifier,
  createCaseRerunPlanner
});
