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
  createCaseCatalogRenderer,
  createCaseResultsRenderer,
  createEvidenceIndexAuthority,
  createOverviewRenderer,
  createReportFactAuthority,
  createReportModelBuilder,
  renderSafeHtmlAttribute,
  renderSafeHtmlText
} = require('./reporting');
const {
  createCaseRerunPlanner,
  createDevelopmentRepairBridge,
  createFailureClassifier,
  createRepairLoopStateMachine
} = require('./repair');
const {
  SIX_DOMAINS,
  createNotApplicableDecisionValidator,
  createOracleRegistry,
  createReadingEvaluator,
  createSixDomainAggregator
} = require('./evaluation');
const {
  createDecisionEngine,
  validateGateDecisionIdentity
} = require('./gates');
const {
  createV1ToV2Migrator
} = require('./migration');
const {
  createCompatibilitySnapshot,
  createHostCompatibilityAuthority,
  compareCompatibilitySnapshots
} = require('./governance');
const {
  createVerificationArtifactStore
} = require('./persistence');
const {
  createRuntimeAuthority
} = require('./runtime/authority');
const {
  createCaseApprovalValidator
} = require('./cases');
const {
  PROTOCOL_ENV,
  REPORT_FILES,
  REGISTERED_PRODUCERS,
  createVerificationArtifactPipeline,
  createProductionVerificationRunner
} = require('./pipeline');

module.exports = Object.freeze({
  createCaseCatalogRenderer,
  createCaseResultsRenderer,
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
  createV1ToV2Migrator,
  createSecretRedactor,
  createCaseFreshnessEvaluator,
  createCaseRerunPlanner,
  createDevelopmentRepairBridge,
  createFailureClassifier,
  createRepairLoopStateMachine,
  createEvidenceIndexAuthority,
  createOverviewRenderer,
  createReportFactAuthority,
  createReportModelBuilder,
  SIX_DOMAINS,
  createNotApplicableDecisionValidator,
  createOracleRegistry,
  createReadingEvaluator,
  createSixDomainAggregator,
  createDecisionEngine,
  validateGateDecisionIdentity,
  createCompatibilitySnapshot,
  createHostCompatibilityAuthority,
  compareCompatibilitySnapshots,
  createCaseApprovalValidator,
  createRuntimeAuthority,
  createVerificationArtifactStore,
  PROTOCOL_ENV,
  REPORT_FILES,
  REGISTERED_PRODUCERS,
  createVerificationArtifactPipeline,
  createProductionVerificationRunner,
  renderSafeHtmlAttribute,
  renderSafeHtmlText
});
