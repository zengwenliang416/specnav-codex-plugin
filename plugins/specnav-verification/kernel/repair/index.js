'use strict';

const {
  ALL_DOMAINS,
  createCaseRerunPlanner
} = require('./case-rerun-planner');
const {
  CLASSIFICATION_POLICY,
  createFailureClassifier
} = require('./failure-classifier');
const {
  OWNERSHIP,
  STANDARD_PACKET_ARTIFACTS,
  STANDARD_REVIEWS,
  createDevelopmentRepairBridge
} = require('./development-repair-bridge');

module.exports = Object.freeze({
  ALL_DOMAINS,
  CLASSIFICATION_POLICY,
  OWNERSHIP,
  STANDARD_PACKET_ARTIFACTS,
  STANDARD_REVIEWS,
  createDevelopmentRepairBridge,
  createFailureClassifier,
  createCaseRerunPlanner
});
