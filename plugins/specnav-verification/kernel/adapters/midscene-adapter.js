'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { deepFreeze } = require('../contracts/schema-registry');
const {
  createSecretRedactor
} = require('../evidence/secret-redactor');
const {
  configuredSecrets,
  providerConfigurationFingerprint,
  providerMetadata,
  selectProviderEnvironment
} = require('../runtime/provider-contract');
const {
  createBrowserAccessPolicy
} = require('../execution/browser-access-policy');
const {
  serializeMidscenePrompt
} = require('../execution/midscene-prompt');
const {
  serializePlaywrightScenario
} = require('../execution/playwright-scenario');
const {
  runPlaywrightWorker
} = require('../execution/playwright-worker');
const {
  prepareArtifactWorkspace,
  publishArtifacts,
  resolveManagedRuntime,
  validateArtifactRoot
} = require('./playwright-adapter');

const PRODUCER = 'midscene-runner';
const INTERACTION_KINDS = new Set(['act', 'tap', 'input', 'query']);
const TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.json',
  '.jsonl',
  '.log',
  '.md',
  '.txt',
  '.xml',
  '.yaml',
  '.yml'
]);

function midsceneBlocker(id, artifact = 'midscene', detail = null) {
  return { id, artifact, detail };
}

function isPlainObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function directoryIsEmpty(directory) {
  try {
    return fs.statSync(directory).isDirectory()
      && fs.readdirSync(directory).length === 0;
  } catch {
    return false;
  }
}

function sanitizeTextArtifacts(root, redactor) {
  const redactedFiles = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`text artifact symlink is not allowed: ${entry.name}`);
      }
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (
        !entry.isFile()
        || !TEXT_ARTIFACT_EXTENSIONS.has(
          path.extname(entry.name).toLowerCase()
        )
      ) {
        continue;
      }
      const content = fs.readFileSync(file, 'utf8');
      const redacted = redactor.redactText(content, {
        field: `midscene.artifact.${path.relative(root, file)}`
      });
      if (!redacted.ok) {
        throw new Error(`text artifact redaction failed: ${entry.name}`);
      }
      if (redacted.redaction_count > 0) {
        fs.writeFileSync(file, redacted.value, {
          encoding: 'utf8',
          flag: 'w',
          mode: 0o600
        });
        redactedFiles.push(path.relative(root, file));
      }
    }
  }

  visit(root);
  return redactedFiles;
}

function discardArtifactWorkspace(workspace) {
  if (!workspace || typeof workspace.stagingRoot !== 'string') return;
  try {
    fs.rmSync(workspace.stagingRoot, {
      force: true,
      maxRetries: 2,
      recursive: true,
      retryDelay: 10
    });
  } catch {
    // The original execution blocker remains authoritative.
  }
}

function validateMidsceneRequest(request) {
  const blockers = [];
  if (!isPlainObject(request)) {
    return {
      ok: false,
      blockers: [midsceneBlocker(
        'verification-execution:midscene-request-invalid'
      )]
    };
  }
  for (const field of [
    'scenario_id',
    'scenario_hash',
    'browser_project',
    'artifact_root',
    'start_url',
    'prompt_id',
    'prompt_hash',
    'prompt',
    'oracle_scenario_hash'
  ]) {
    if (typeof request[field] !== 'string' || request[field].trim() === '') {
      blockers.push(midsceneBlocker(
        `verification-execution:midscene-${field.replaceAll('_', '-')}-invalid`,
        field
      ));
    }
  }
  if (request.browser_project !== 'chromium') {
    blockers.push(midsceneBlocker(
      'verification-execution:midscene-browser-project-unsupported',
      'browser_project',
      request.browser_project || null
    ));
  }
  if (
    !path.isAbsolute(request.artifact_root || '')
    || (
      fs.existsSync(request.artifact_root)
      && !directoryIsEmpty(request.artifact_root)
    )
  ) {
    blockers.push(midsceneBlocker(
      'verification-execution:midscene-artifact-root-invalid',
      'artifact_root'
    ));
  }
  let policy;
  try {
    policy = createBrowserAccessPolicy(request.allowed_origins);
  } catch {
    blockers.push(midsceneBlocker(
      'verification-execution:midscene-allowed-origins-invalid',
      'allowed_origins'
    ));
  }
  if (policy && !policy.allows(request.start_url)) {
    blockers.push(midsceneBlocker(
      'verification-execution:midscene-start-url-denied',
      'start_url',
      policy.target(request.start_url)
    ));
  }
  const prompt = serializeMidscenePrompt(request.prompt);
  if (prompt.blocker) blockers.push(prompt.blocker);
  if (prompt.hash && prompt.hash !== request.prompt_hash) {
    blockers.push(midsceneBlocker(
      'verification-execution:midscene-prompt-hash-mismatch',
      'prompt_hash',
      prompt.hash
    ));
  }
  const oracle = serializePlaywrightScenario(request.oracle_scenario);
  if (oracle.blocker) blockers.push(midsceneBlocker(
    'verification-execution:midscene-oracle-scenario-invalid',
    'oracle_scenario',
    oracle.blocker.detail
  ));
  if (oracle.hash && oracle.hash !== request.oracle_scenario_hash) {
    blockers.push(midsceneBlocker(
      'verification-execution:midscene-oracle-scenario-hash-mismatch',
      'oracle_scenario_hash',
      oracle.hash
    ));
  }
  if (
    !isPlainObject(request.interaction)
    || !INTERACTION_KINDS.has(request.interaction.kind)
    || (
      request.interaction.kind === 'input'
      && typeof request.interaction.value !== 'string'
    )
  ) {
    blockers.push(midsceneBlocker(
      'verification-execution:midscene-interaction-invalid',
      'interaction'
    ));
  }
  return {
    ok: blockers.length === 0,
    blockers
  };
}

function resolveMidscenePackage(runtime) {
  const packageReceipt = runtime.receipt.packages?.find(
    (entry) => entry?.name === '@midscene/web'
  );
  if (
    !packageReceipt
    || typeof packageReceipt.version !== 'string'
    || packageReceipt.integrity_verified !== true
  ) {
    return {
      blocker: midsceneBlocker(
        'verification-execution:midscene-runtime-package-unverified',
        path.join(runtime.runtimeRoot, 'install-receipt.json')
      )
    };
  }
  try {
    const packageFile = fs.realpathSync(path.join(
      runtime.runtimeRoot,
      'node_modules',
      '@midscene',
      'web',
      'package.json'
    ));
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    if (packageJson.version !== packageReceipt.version) {
      throw new Error(
        `version mismatch: ${packageJson.version} != ${packageReceipt.version}`
      );
    }
    return {
      version: packageReceipt.version
    };
  } catch (error) {
    return {
      blocker: midsceneBlocker(
        'verification-execution:midscene-runtime-package-unavailable',
        runtime.runtimeRoot,
        error instanceof Error ? error.message : String(error)
      )
    };
  }
}

function cloneScenarioData(value) {
  try {
    return { value: structuredClone(value === undefined ? null : value) };
  } catch (error) {
    return {
      blocker: midsceneBlocker(
        'verification-execution:midscene-scenario-data-invalid',
        'scenario_data',
        error instanceof Error ? error.message : String(error)
      )
    };
  }
}

function createMidsceneAdapter(factoryOptions = {}) {
  const runWorker = factoryOptions.runWorker || runPlaywrightWorker;
  const resolveRuntime = factoryOptions.resolveRuntime || resolveManagedRuntime;
  const configuredProviderEnvironment = Object.prototype.hasOwnProperty.call(
    factoryOptions,
    'providerEnvironment'
  )
    ? factoryOptions.providerEnvironment
    : process.env;

  async function interact(request, executeOptions = {}) {
    const options = { ...factoryOptions, ...executeOptions };
    const environment = selectProviderEnvironment(
      configuredProviderEnvironment
    );
    if (!environment) {
      return deepFreeze({
        status: 'blocked',
        observation: null,
        prompt: null,
        model: null,
        screenshots: [],
        artifacts: [],
        assertions: [],
        console: [],
        network: [],
        blockers: [midsceneBlocker(
          'verification-execution:midscene-provider-environment-invalid'
        )],
        timed_out: false,
        canceled: false,
        fallback_used: false
      });
    }
    const redactor = createSecretRedactor({
      secrets: configuredSecrets(environment)
    });
    const onEvent = typeof options.onEvent === 'function'
      ? options.onEvent
      : () => {};
    const state = {
      artifacts: [],
      assertions: [],
      console: [],
      network: [],
      browser: null
    };

    function sanitize(value, field) {
      const result = redactor.redactValue(value, { field });
      return result.ok ? result.value : null;
    }

    function finish(overrides) {
      const result = deepFreeze({
        status: 'blocked',
        observation: null,
        prompt: null,
        model: null,
        screenshots: [],
        artifacts: state.artifacts,
        assertions: state.assertions,
        console: state.console,
        network: state.network,
        blockers: [],
        timed_out: false,
        canceled: false,
        fallback_used: false,
        ...overrides
      });
      try {
        onEvent({ type: 'terminal', result });
      } catch {
        // Event observers never control the Midscene attempt.
      }
      return result;
    }

    const validation = validateMidsceneRequest(request);
    if (!validation.ok) {
      return finish({ blockers: validation.blockers });
    }
    const artifactProblems = validateArtifactRoot(
      request.artifact_root,
      options.projectRoot
    );
    if (artifactProblems.length > 0) {
      return finish({
        blockers: artifactProblems.map((entry) => ({
          ...entry,
          id: entry.id.replace('playwright', 'midscene')
        }))
      });
    }
    const runtime = resolveRuntime(options.runtimeStatus);
    if (!runtime || !Array.isArray(runtime.blockers)) {
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-runtime-result-invalid'
      )] });
    }
    if (runtime.blockers.length > 0) {
      return finish({
        blockers: sanitize(runtime.blockers, 'runtime.blockers')
          || [midsceneBlocker(
            'verification-execution:midscene-runtime-not-ready'
          )]
      });
    }
    const midscenePackage = resolveMidscenePackage(runtime);
    if (midscenePackage.blocker) {
      return finish({ blockers: [midscenePackage.blocker] });
    }
    const model = providerMetadata(environment);
    const configurationFingerprint = providerConfigurationFingerprint(
      environment
    );
    if (
      options.runtimeStatus.checks?.provider?.configured !== true
      || !model.name
      || !model.family
      || !model.credential_source
      || !model.base_url
    ) {
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-provider-not-configured',
        'environment'
      )] });
    }
    if (
      !configurationFingerprint
      || configurationFingerprint
        !== options.runtimeStatus.checks.provider.configuration_fingerprint
    ) {
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-provider-configuration-mismatch',
        'environment'
      )] });
    }
    if (!['deterministic', 'human_signoff'].includes(options.oracleMode)) {
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-oracle-mode-invalid',
        request.scenario_id
      )] });
    }
    let providerUrl;
    try {
      providerUrl = new URL(model.base_url);
      if (
        providerUrl.protocol !== 'https:'
        || providerUrl.username !== ''
        || providerUrl.password !== ''
      ) {
        throw new Error('provider base URL is not explicit HTTPS');
      }
    } catch {
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-provider-base-url-invalid',
        'environment'
      )] });
    }
    const oracle = serializePlaywrightScenario(request.oracle_scenario);
    if (
      oracle.blocker
      || oracle.hash !== request.oracle_scenario_hash
      || oracle.hash !== options.expectedOracleScenarioHash
    ) {
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-oracle-scenario-hash-mismatch',
        request.scenario_id,
        oracle.hash
      )] });
    }
    if (
      request.prompt_hash !== options.expectedPromptHash
      || request.start_url !== options.expectedStartUrl
    ) {
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-approved-input-mismatch',
        request.scenario_id
      )] });
    }
    const scenarioData = cloneScenarioData(request.scenario_data);
    if (scenarioData.blocker) {
      return finish({ blockers: [scenarioData.blocker] });
    }
    const workspace = prepareArtifactWorkspace(
      request.artifact_root,
      options.projectRoot
    );
    if (workspace.blocker) {
      return finish({ blockers: [{
        ...workspace.blocker,
        id: workspace.blocker.id.replace('playwright', 'midscene')
      }] });
    }
    state.browser = {
      project: 'chromium',
      executable: runtime.executable,
      browser_version: runtime.chromiumReceipt.browser_version || null,
      revision: runtime.chromiumReceipt.revision || null,
      playwright_version: runtime.playwrightPackage.version,
      midscene_version: midscenePackage.version,
      runtime_root: runtime.runtimeRoot
    };

    let workerResult;
    try {
      workerResult = await runWorker({
        mode: 'midscene',
        allowed_origins: [...options.allowedOrigins],
        assertion_contract_ids: [...options.oracleAssertionIds],
        browser: state.browser,
        browser_project: request.browser_project,
        executable: runtime.executable,
        interaction: structuredClone(request.interaction),
        midscene_version: midscenePackage.version,
        oracle_mode: options.oracleMode,
        oracle_scenario_source: oracle.source,
        playwright_version: runtime.playwrightPackage.version,
        prompt: request.prompt,
        prompt_id: request.prompt_id,
        provider_base_url: providerUrl.toString(),
        runtime_root: runtime.runtimeRoot,
        scenario_data: scenarioData.value,
        scenario_hash: request.scenario_hash,
        scenario_id: request.scenario_id,
        staging_root: workspace.stagingRoot,
        start_url: request.start_url,
        timeout_ms: options.timeoutMs
      }, {
        signal: options.signal,
        providerEnvironment: environment,
        onEvent(event) {
          const safeEvent = sanitize(event, 'midscene.event');
          if (!safeEvent) return;
          try {
            onEvent(safeEvent);
          } catch {
            // Event observers never control the Midscene attempt.
          }
        }
      });
    } catch (error) {
      discardArtifactWorkspace(workspace);
      const safeError = redactor.redactText(
        error instanceof Error ? error.message : String(error),
        { field: 'midscene.error' }
      );
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-worker-failed',
        'midscene-worker',
        safeError.ok ? safeError.value : null
      )] });
    }
    if (!isPlainObject(workerResult)) {
      discardArtifactWorkspace(workspace);
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-worker-result-invalid'
      )] });
    }
    state.assertions = sanitize(
      Array.isArray(workerResult.assertions) ? workerResult.assertions : [],
      'midscene.assertions'
    ) || [];
    state.console = sanitize(
      Array.isArray(workerResult.console) ? workerResult.console : [],
      'midscene.console'
    ) || [];
    state.network = sanitize(
      Array.isArray(workerResult.network) ? workerResult.network : [],
      'midscene.network'
    ) || [];
    const blockers = sanitize(
      Array.isArray(workerResult.blockers) ? workerResult.blockers : [],
      'midscene.blockers'
    ) || [];

    try {
      sanitizeTextArtifacts(workspace.stagingRoot, redactor);
    } catch (error) {
      discardArtifactWorkspace(workspace);
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-artifact-redaction-failed',
        workspace.stagingRoot,
        sanitize(
          error instanceof Error ? error.message : String(error),
          'artifact.redaction.error'
        )
      )] });
    }
    const published = publishArtifacts(workspace, state, () => {}, {
      producer: PRODUCER
    });
    if (published.blocker) {
      discardArtifactWorkspace(workspace);
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-artifact-publish-failed',
        workspace.destination,
        sanitize(published.blocker.detail, 'artifact.error')
      )] });
    }
    state.artifacts = published.artifacts;
    const screenshot = state.artifacts.find(
      (entry) => entry.kind === 'screenshot'
    );
    if (!screenshot) {
      if (workerResult.status !== 'observed' || blockers.length > 0) {
        return finish({
          status: typeof workerResult.status === 'string'
            ? workerResult.status
            : 'blocked',
          artifacts: state.artifacts,
          assertions: state.assertions,
          console: state.console,
          network: state.network,
          blockers: blockers.length > 0
            ? blockers
            : [midsceneBlocker(
              'verification-execution:midscene-worker-terminal-invalid',
              'midscene-worker'
            )],
          timed_out: workerResult.timed_out === true,
          canceled: workerResult.canceled === true
        });
      }
      return finish({ blockers: [midsceneBlocker(
        'verification-execution:midscene-screenshot-missing'
      )] });
    }
    const safeObservation = sanitize(
      workerResult.observation,
      'midscene.observation'
    );
    const safeModel = sanitize({
      name: model.name,
      family: model.family,
      base_url_present: true,
      credential_source: model.credential_source,
      secret_values_exposed: false
    }, 'midscene.model');
    const safePrompt = redactor.redactText(request.prompt, {
      field: 'midscene.prompt'
    });
    return finish({
      status: workerResult.status,
      observation: safeObservation,
      prompt: safePrompt.ok
        ? {
          id: request.prompt_id,
          hash: request.prompt_hash,
          text: safePrompt.value,
          redaction: safePrompt.redaction
        }
        : null,
      model: safeModel,
      screenshots: [screenshot],
      artifacts: state.artifacts,
      assertions: state.assertions,
      console: state.console,
      network: state.network,
      blockers,
      timed_out: workerResult.timed_out === true,
      canceled: workerResult.canceled === true,
      fallback_used: false
    });
  }

  return Object.freeze({
    validate: validateMidsceneRequest,
    interact
  });
}

module.exports = {
  createMidsceneAdapter,
  discardArtifactWorkspace,
  providerEnvironment: selectProviderEnvironment,
  providerMetadata,
  resolveMidscenePackage,
  sanitizeTextArtifacts,
  validateMidsceneRequest
};
