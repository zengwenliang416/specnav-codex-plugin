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
const {
  PROPOSAL_TARGETS,
  createRepairLoopStateMachine
} = require('./repair-loop-state-machine');

module.exports = Object.freeze({
  ALL_DOMAINS,
  CLASSIFICATION_POLICY,
  OWNERSHIP,
  PROPOSAL_TARGETS,
  STANDARD_PACKET_ARTIFACTS,
  STANDARD_REVIEWS,
  createDevelopmentRepairBridge,
  createFailureClassifier,
  createCaseRerunPlanner,
  createRepairLoopStateMachine
});
