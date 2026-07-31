'use strict';

const metadata = require('./metadata');
const { createServices, serviceContracts } = require('./contracts');
const {
  ENTITY_TYPES,
  createSchemaRegistry
} = require('./contracts/schema-registry');

module.exports = Object.freeze({
  metadata,
  serviceContracts,
  createServices,
  ENTITY_TYPES,
  createSchemaRegistry
});
