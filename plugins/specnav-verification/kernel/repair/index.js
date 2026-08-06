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
const {
  CLAIMS,
  PRODUCERS,
  createTrustedFactAuthority
} = require('./trusted-fact-authority');
const {
  TARGET_STATUS,
  createTransitionApplier
} = require('./transition-applier');
const {
  createFailureStateReducer
} = require('./failure-state-reducer');

module.exports = Object.freeze({
  ALL_DOMAINS,
  CLASSIFICATION_POLICY,
  OWNERSHIP,
  CLAIMS,
  PRODUCERS,
  PROPOSAL_TARGETS,
  TARGET_STATUS,
  STANDARD_PACKET_ARTIFACTS,
  STANDARD_REVIEWS,
  createDevelopmentRepairBridge,
  createFailureClassifier,
  createFailureStateReducer,
  createCaseRerunPlanner,
  createRepairLoopStateMachine,
  createTransitionApplier,
  createTrustedFactAuthority
});
