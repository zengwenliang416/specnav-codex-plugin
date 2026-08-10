'use strict';

const {
  createExecutionOrchestrator
} = require('./orchestrator');
const {
  createEventSequence
} = require('./event-sequence');
const {
  evaluateMidsceneOracle
} = require('./midscene-oracle');
const {
  createHostRunnerIdentity,
  createHostSandboxPlan,
  createHostProofLauncher
} = require('./host-proof-launcher');

module.exports = Object.freeze({
  createEventSequence,
  createExecutionOrchestrator,
  createHostRunnerIdentity,
  createHostSandboxPlan,
  createHostProofLauncher,
  evaluateMidsceneOracle
});
