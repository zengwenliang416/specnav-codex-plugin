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
  createMidsceneAdapter
} = require('./adapters/midscene-adapter');
const {
  createExecutionOrchestrator
} = require('./execution');
const {
  createEvidenceStore,
  createEvidenceIntegrityChecker,
  createSecretRedactor,
  createCaseFreshnessEvaluator
} = require('./evidence');
const {
  renderSafeHtmlText
} = require('./reporting');
const {
  createCaseRerunPlanner
} = require('./repair');
const {
  SIX_DOMAINS,
  createNotApplicableDecisionValidator,
  createOracleRegistry,
  createReadingEvaluator,
  createSixDomainAggregator
} = require('./evaluation');
const {
  createDecisionEngine
} = require('./gates');

module.exports = Object.freeze({
  metadata,
  serviceContracts,
  createServices,
  ENTITY_TYPES,
  createSchemaRegistry,
  createCommandAdapter,
  createMidsceneAdapter,
  createPlaywrightAdapter,
  createExecutionOrchestrator,
  createEvidenceStore,
  createEvidenceIntegrityChecker,
  createSecretRedactor,
  createCaseFreshnessEvaluator,
  createCaseRerunPlanner,
  SIX_DOMAINS,
  createNotApplicableDecisionValidator,
  createOracleRegistry,
  createReadingEvaluator,
  createSixDomainAggregator,
  createDecisionEngine,
  renderSafeHtmlText
});
