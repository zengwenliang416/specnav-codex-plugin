'use strict';

const {
  createExecutionOrchestrator
} = require('./orchestrator');
const {
  createEventSequence
} = require('./event-sequence');

module.exports = Object.freeze({
  createEventSequence,
  createExecutionOrchestrator
});
