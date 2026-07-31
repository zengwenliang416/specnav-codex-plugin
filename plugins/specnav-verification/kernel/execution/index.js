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

module.exports = Object.freeze({
  createEventSequence,
  createExecutionOrchestrator,
  evaluateMidsceneOracle
});
