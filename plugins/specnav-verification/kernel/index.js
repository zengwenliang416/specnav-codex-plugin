'use strict';

const metadata = require('./metadata');
const { createServices, serviceContracts } = require('./contracts');
const {
  ENTITY_TYPES,
  createSchemaRegistry
} = require('./contracts/schema-registry');
const {
  createCommandAdapter
} = require('./adapters/command-adapter');
const {
  createExecutionOrchestrator
} = require('./execution');

module.exports = Object.freeze({
  metadata,
  serviceContracts,
  createServices,
  ENTITY_TYPES,
  createSchemaRegistry,
  createCommandAdapter,
  createExecutionOrchestrator
});
