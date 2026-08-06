'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins/specnav-verification');

test('kernel package exposes one versioned public entry and schema-only subpath', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_ROOT, 'package.json'),
    'utf8'
  ));

  assert.equal(manifest.name, '@specnav/verification-kernel');
  assert.equal(manifest.version, '2.0.0-alpha.2');
  assert.equal(manifest.main, './kernel/index.js');
  assert.deepEqual(manifest.exports, {
    '.': './kernel/index.js',
    './schemas/*': './schemas/*',
    './package.json': './package.json'
  });
  assert.deepEqual(manifest.files, [
    'assets/',
    'kernel/',
    'schemas/',
    'scripts/verification-v2-run.js',
    'scripts/verification-v2-repair-loop.js',
    'scripts/rerun-scope.js'
  ]);
  assert.deepEqual(manifest.bin, {
    'specnav-verification-execute': './scripts/verification-v2-run.js',
    'specnav-verification-repair': './scripts/verification-v2-repair-loop.js'
  });
});

test('public entry exposes immutable metadata and explicit service contracts', () => {
  const kernel = require(PLUGIN_ROOT);

  assert.equal(kernel.metadata.name, '@specnav/verification-kernel');
  assert.equal(kernel.metadata.version, '2.0.0-alpha.2');
  assert.equal(kernel.metadata.apiVersion, 'specnav.verification.kernel.v1');
  assert.match(kernel.metadata.contractDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(kernel.metadata), true);
  assert.equal(typeof kernel.createEvidenceStore, 'function');
  assert.equal(typeof kernel.createVerificationArtifactStore, 'function');
  assert.equal(typeof kernel.createProductionVerificationRunner, 'function');
  assert.equal(typeof kernel.createVerificationArtifactPipeline, 'function');
  assert.equal(typeof kernel.createEvidenceIntegrityChecker, 'function');
  assert.equal(typeof kernel.createV1ToV2Migrator, 'function');
  assert.equal(typeof kernel.createSecretRedactor, 'function');
  assert.equal(typeof kernel.createEvidenceIndexAuthority, 'function');
  assert.equal(typeof kernel.createCaseCatalogRenderer, 'function');
  assert.equal(typeof kernel.createCaseResultsRenderer, 'function');
  assert.equal(typeof kernel.createReportFactAuthority, 'function');
  assert.equal(typeof kernel.createOverviewRenderer, 'function');
  assert.equal(typeof kernel.renderSafeHtmlAttribute, 'function');
  assert.equal(typeof kernel.renderSafeHtmlText, 'function');
  assert.equal(typeof kernel.createCaseFreshnessEvaluator, 'function');
  assert.equal(typeof kernel.createCaseRerunPlanner, 'function');
  assert.equal(typeof kernel.createFailureClassifier, 'function');
  assert.equal(typeof kernel.createFailureStateReducer, 'function');
  assert.equal(typeof kernel.createDevelopmentRepairBridge, 'function');
  assert.equal(typeof kernel.createRepairLoopStateMachine, 'function');
  assert.equal(typeof kernel.createTransitionApplier, 'function');
  assert.equal(kernel.createTrustedFactAuthority, undefined);
  assert.equal(typeof kernel.createReportModelBuilder, 'function');
  assert.equal(typeof kernel.createMidsceneAdapter, 'function');
  assert.equal(typeof kernel.createOracleRegistry, 'function');
  assert.equal(typeof kernel.createReadingEvaluator, 'function');
  assert.deepEqual(kernel.SIX_DOMAINS, [
    'facticity',
    'static',
    'unit',
    'redteam',
    'e2e',
    'sensory'
  ]);
  assert.equal(Object.isFrozen(kernel.SIX_DOMAINS), true);
  assert.equal(typeof kernel.createSixDomainAggregator, 'function');
  assert.equal(typeof kernel.createDecisionEngine, 'function');
  assert.equal(
    typeof kernel.createNotApplicableDecisionValidator,
    'function'
  );
  assert.deepEqual(
    kernel.serviceContracts.evidenceStore.methods,
    ['append', 'rebuildIndex']
  );

  assert.deepEqual(Object.keys(kernel.serviceContracts).sort(), [
    'commandRunner',
    'evidenceStore',
    'failureClassifier',
    'midsceneRunner',
    'playwrightRunner',
    'reportRenderer'
  ]);
});

test('service creation requires every adapter and never falls back', () => {
  const kernel = require(PLUGIN_ROOT);

  assert.throws(
    () => kernel.createServices({}),
    /verification-kernel:missing-service:commandRunner/
  );

  const adapters = {
    commandRunner: { execute() {} },
    playwrightRunner: { execute() {} },
    midsceneRunner: { interact() {} },
    evidenceStore: {
      append() {},
      rebuildIndex() {}
    },
    failureClassifier: { classify() {} },
    reportRenderer: { render() {} }
  };
  const services = kernel.createServices(adapters);

  assert.equal(services.commandRunner, adapters.commandRunner);
  assert.equal(Object.isFrozen(services), true);
});

test('kernel source contains no host runtime dependency', () => {
  const kernelDir = path.join(PLUGIN_ROOT, 'kernel');
  const files = fs.readdirSync(kernelDir, {
    recursive: true,
    withFileTypes: true
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => (
      path.relative(kernelDir, file).split(path.sep).join('/')
        !== 'governance/host-provenance.js'
    ));
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const kernel = require(PLUGIN_ROOT);

  assert.doesNotMatch(source, /\b(?:codex|claude|codefree|opencode)\b/i);
  assert.doesNotMatch(source, /process\.env\.(?:CODEX|CLAUDE|OPENCODE)/);
  assert.equal(kernel.createHostSyncPlan, undefined);
  assert.equal(kernel.transformSkill, undefined);
});
