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
  createPlaywrightAdapter
} = require('./adapters/playwright-adapter');
const {
  createExecutionOrchestrator
} = require('./execution');
const {
  createEvidenceStore
} = require('./evidence');

module.exports = Object.freeze({
  metadata,
  serviceContracts,
  createServices,
  ENTITY_TYPES,
  createSchemaRegistry,
  createCommandAdapter,
  createPlaywrightAdapter,
  createExecutionOrchestrator,
  createEvidenceStore
});
