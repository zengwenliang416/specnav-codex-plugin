'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ROOT,
  PROVIDER_ENV,
  createOrchestrator,
  midsceneExecutionFixture,
  midsceneRequest,
  providerReadyRuntimeStatus
} = require('./test-helpers');

function writeWorkerScreenshot(payload, content = 'png') {
  fs.writeFileSync(
    path.join(payload.staging_root, 'screenshot.png'),
    content
  );
}

function observedWorker(overrides = {}) {
  return async (payload) => {
    writeWorkerScreenshot(payload);
    return {
      status: 'observed',
      observation: {
        description: 'The expected UI is present.',
        response: null
      },
      assertions: [{
        id: 'assertion-1',
        method: 'ok',
        actual: true,
        expected: true,
        status: 'passed'
      }],
      console: [],
      network: [],
      blockers: [],
      timed_out: false,
      canceled: false,
      ...overrides
    };
  };
}

function adapterFor(runWorker) {
  const {
    createMidsceneAdapter
  } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/midscene-adapter.js`
  );
  return createMidsceneAdapter({
    runWorker,
    providerEnvironment: PROVIDER_ENV
  });
}

function privateStagingDirectories(fixture) {
  const parent = path.dirname(fixture.artifactRoot);
  const prefix = `.${path.basename(fixture.artifactRoot)}.staging-`;
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent).filter((name) => name.startsWith(prefix));
}

test('midscene case schema requires prompt, start URL, scenario, and oracle linkage', () => {
  const { readySchemaRegistry, sampleCase } = require('../cases/test-helpers');
  const result = readySchemaRegistry().validate('test-case', sampleCase({
    runner: {
      kind: 'midscene',
      timeout_ms: 1000,
      requires_midscene: true
    }
  }));

  assert.equal(result.ok, false);
  const requiredFields = new Set(result.blockers.map((entry) => entry.field));
  assert.deepEqual(
    [...requiredFields].filter((field) => [
      '/runner/scenario_id',
      '/runner/scenario_hash',
      '/runner/browser_project',
      '/runner/allowed_origins',
      '/runner/prompt_id',
      '/runner/prompt_hash',
      '/runner/start_url',
      '/runner/oracle_scenario_hash',
      '/runner/oracle_assertion_ids'
    ].includes(field)).sort(),
    [
      '/runner/allowed_origins',
      '/runner/browser_project',
      '/runner/oracle_assertion_ids',
      '/runner/oracle_scenario_hash',
      '/runner/prompt_hash',
      '/runner/prompt_id',
      '/runner/scenario_hash',
      '/runner/scenario_id',
      '/runner/start_url'
    ]
  );
});

test('kernel exports Midscene adapter and unified execution method', () => {
  const kernel = require(`${ROOT}/plugins/specnav-verification`);
  const fixture = midsceneExecutionFixture();
  try {
    assert.equal(typeof kernel.createMidsceneAdapter, 'function');
    const orchestrator = createOrchestrator(
      fixture,
      adapterFor(observedWorker())
    );
    assert.equal(typeof orchestrator.executeMidscene, 'function');
  } finally {
    fixture.cleanup();
  }
});

test('missing provider configuration blocks before Midscene interaction', async () => {
  const runtimeStatus = providerReadyRuntimeStatus();
  runtimeStatus.checks.provider.configured = false;
  const fixture = midsceneExecutionFixture({ runtimeStatus });
  let interactionCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async interact() {
      interactionCalls += 1;
      throw new Error('must not execute');
    }
  });
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(fixture));
    assert.equal(result.status, 'blocked');
    assert.equal(result.attempt, null);
    assert.equal(
      result.blockers[0].id,
      'verification-execution:midscene-provider-not-configured'
    );
    assert.equal(interactionCalls, 0);
  } finally {
    fixture.cleanup();
  }
});

test('adapter redacts prompts, observations, logs, model metadata, and errors', async () => {
  const fixture = midsceneExecutionFixture({
    prompt: 'Use api_key=secret-value and open the payroll summary.'
  });
  const adapter = adapterFor(async (payload, options) => {
    assert.equal(payload.prompt.includes('secret-value'), true);
    assert.equal(
      options.providerEnvironment.MIDSCENE_MODEL_API_KEY,
      'secret-value'
    );
    writeWorkerScreenshot(payload);
    return {
      status: 'observed',
      observation: {
        description: 'completed secret-value'
      },
      assertions: [{
        id: 'assertion-1',
        method: 'ok',
        actual: true,
        expected: true,
        status: 'passed'
      }],
      console: [{ text: 'api_key=secret-value' }],
      network: [],
      blockers: [],
      timed_out: false,
      canceled: false
    };
  });
  const request = midsceneRequest(fixture).midscene;
  const before = structuredClone({
    ...request,
    oracle_scenario: null
  });

  try {
    const result = await adapter.interact(request, {
      runtimeStatus: fixture.runtimeStatus,
      projectRoot: fixture.projectRoot,
      timeoutMs: 1000,
      providerEnvironment: {
        ...PROVIDER_ENV,
        MIDSCENE_MODEL_NAME: 'model-secret-value'
      },
      allowedOrigins: fixture.testCase.runner.allowed_origins,
      expectedOracleScenarioHash:
        fixture.testCase.runner.oracle_scenario_hash,
      expectedPromptHash: fixture.testCase.runner.prompt_hash,
      expectedStartUrl: fixture.testCase.runner.start_url,
      oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
      oracleMode: 'deterministic'
    });
    assert.equal(result.status, 'observed');
    assert.equal(JSON.stringify(result).includes('secret-value'), false);
    assert.equal(result.prompt.text.includes('[REDACTED'), true);
    assert.equal(result.model.secret_values_exposed, false);
    assert.deepEqual({ ...request, oracle_scenario: null }, before);
  } finally {
    fixture.cleanup();
  }
});

test('adapter redacts generated Midscene text artifacts before publication', async () => {
  const fixture = midsceneExecutionFixture();
  const adapter = adapterFor(async (payload) => {
    writeWorkerScreenshot(payload);
    const logDirectory = path.join(payload.staging_root, 'midscene_run', 'log');
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(logDirectory, 'ai-config.log'),
      [
        "MIDSCENE_MODEL_API_KEY: 'sk-********IoY'",
        'Authorization: Bearer secret-value',
        'status: ready'
      ].join('\n')
    );
    return observedWorker()(payload);
  });

  try {
    const result = await adapter.interact(
      midsceneRequest(fixture).midscene,
      {
        runtimeStatus: fixture.runtimeStatus,
        projectRoot: fixture.projectRoot,
        timeoutMs: 100,
        allowedOrigins: fixture.testCase.runner.allowed_origins,
        expectedOracleScenarioHash:
          fixture.testCase.runner.oracle_scenario_hash,
        expectedPromptHash: fixture.testCase.runner.prompt_hash,
        expectedStartUrl: fixture.testCase.runner.start_url,
        oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
        oracleMode: 'deterministic'
      }
    );
    assert.equal(result.status, 'observed');
    const publishedLog = fs.readFileSync(path.join(
      fixture.artifactRoot,
      'midscene_run',
      'log',
      'ai-config.log'
    ), 'utf8');
    assert.doesNotMatch(publishedLog, /sk-\*+IoY/);
    assert.doesNotMatch(publishedLog, /secret-value/);
    assert.match(publishedLog, /MIDSCENE_MODEL_API_KEY: \[REDACTED\]/);
    assert.match(publishedLog, /Authorization: Bearer \[REDACTED\]/);
    assert.match(publishedLog, /status: ready/);
  } finally {
    fixture.cleanup();
  }
});

test('adapter delegates to the sandboxed Playwright worker without a raw Page', async () => {
  const fixture = midsceneExecutionFixture();
  let capturedPayload = null;
  let capturedOptions = null;
  const adapter = adapterFor(async (payload, options) => {
    capturedPayload = structuredClone(payload);
    capturedOptions = {
      providerEnvironment: { ...options.providerEnvironment },
      hasSignal: Object.prototype.hasOwnProperty.call(options, 'signal')
    };
    writeWorkerScreenshot(payload);
    return observedWorker()(payload);
  });
  try {
    const result = await adapter.interact(
      midsceneRequest(fixture).midscene,
      {
        runtimeStatus: fixture.runtimeStatus,
        projectRoot: fixture.projectRoot,
        timeoutMs: 100,
        providerEnvironment: PROVIDER_ENV,
        allowedOrigins: fixture.testCase.runner.allowed_origins,
        expectedOracleScenarioHash:
          fixture.testCase.runner.oracle_scenario_hash,
        expectedPromptHash: fixture.testCase.runner.prompt_hash,
        expectedStartUrl: fixture.testCase.runner.start_url,
        oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
        oracleMode: 'deterministic'
      }
    );
    assert.equal(result.status, 'observed');
    assert.equal(capturedPayload.mode, 'midscene');
    assert.equal('page' in capturedPayload, false);
    assert.equal(
      capturedPayload.provider_base_url,
      'https://provider.invalid/v1'
    );
    assert.match(capturedPayload.oracle_scenario_source, /assertion\.ok/);
    assert.equal(
      capturedOptions.providerEnvironment.MIDSCENE_MODEL_API_KEY,
      'secret-value'
    );
  } finally {
    fixture.cleanup();
  }
});

test('execute-time provider overrides cannot change the approved provider target', async () => {
  const fixture = midsceneExecutionFixture();
  let capturedEnvironment = null;
  const adapter = adapterFor(async (payload, options) => {
    capturedEnvironment = { ...options.providerEnvironment };
    writeWorkerScreenshot(payload);
    return observedWorker()(payload);
  });
  try {
    const result = await adapter.interact(
      midsceneRequest(fixture).midscene,
      {
        runtimeStatus: fixture.runtimeStatus,
        projectRoot: fixture.projectRoot,
        timeoutMs: 100,
        providerEnvironment: {
          ...PROVIDER_ENV,
          MIDSCENE_MODEL_BASE_URL: 'https://attacker.invalid/v1'
        },
        allowedOrigins: fixture.testCase.runner.allowed_origins,
        expectedOracleScenarioHash:
          fixture.testCase.runner.oracle_scenario_hash,
        expectedPromptHash: fixture.testCase.runner.prompt_hash,
        expectedStartUrl: fixture.testCase.runner.start_url,
        oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
        oracleMode: 'deterministic'
      }
    );
    assert.equal(result.status, 'observed');
    assert.equal(
      capturedEnvironment.MIDSCENE_MODEL_BASE_URL,
      PROVIDER_ENV.MIDSCENE_MODEL_BASE_URL
    );
  } finally {
    fixture.cleanup();
  }
});

test('adapter blocks when doctor and adapter provider configurations differ', async () => {
  const fixture = midsceneExecutionFixture();
  const adapter = adapterFor(observedWorker());
  const runtimeStatus = structuredClone(fixture.runtimeStatus);
  runtimeStatus.checks.provider.configuration_fingerprint = '0'.repeat(64);
  try {
    const result = await adapter.interact(
      midsceneRequest(fixture).midscene,
      {
        runtimeStatus,
        projectRoot: fixture.projectRoot,
        timeoutMs: 100,
        allowedOrigins: fixture.testCase.runner.allowed_origins,
        expectedOracleScenarioHash:
          fixture.testCase.runner.oracle_scenario_hash,
        expectedPromptHash: fixture.testCase.runner.prompt_hash,
        expectedStartUrl: fixture.testCase.runner.start_url,
        oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
        oracleMode: 'deterministic'
      }
    );
    assert.equal(result.status, 'blocked');
    assert.equal(
      result.blockers[0].id,
      'verification-execution:midscene-provider-configuration-mismatch'
    );
  } finally {
    fixture.cleanup();
  }
});

test('human signoff mode reaches the worker without requiring assertions', async () => {
  const fixture = midsceneExecutionFixture({
    oracleType: 'human_signoff',
    humanSignoffAllowed: true
  });
  let capturedMode = null;
  const adapter = adapterFor(async (payload) => {
    capturedMode = payload.oracle_mode;
    writeWorkerScreenshot(payload);
    return {
      status: 'observed',
      observation: { description: 'ready for human review' },
      assertions: [],
      console: [],
      network: [],
      blockers: [],
      timed_out: false,
      canceled: false
    };
  });
  try {
    const result = await adapter.interact(
      midsceneRequest(fixture).midscene,
      {
        runtimeStatus: fixture.runtimeStatus,
        projectRoot: fixture.projectRoot,
        timeoutMs: 100,
        allowedOrigins: fixture.testCase.runner.allowed_origins,
        expectedOracleScenarioHash:
          fixture.testCase.runner.oracle_scenario_hash,
        expectedPromptHash: fixture.testCase.runner.prompt_hash,
        expectedStartUrl: fixture.testCase.runner.start_url,
        oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
        oracleMode: 'human_signoff'
      }
    );
    assert.equal(result.status, 'observed');
    assert.equal(capturedMode, 'human_signoff');
    assert.deepEqual(result.assertions, []);
  } finally {
    fixture.cleanup();
  }
});

test('adapter fails closed for worker exceptions, timeout, cancellation, and missing screenshots', async () => {
  const cases = [
    {
      name: 'exception',
      worker: async () => {
        throw new Error('provider secret-value exploded');
      },
      blocker: 'verification-execution:midscene-worker-failed'
    },
    {
      name: 'timeout',
      worker: async (payload) => {
        writeWorkerScreenshot(payload);
        return {
          status: 'failed',
          assertions: [],
          console: [],
          network: [],
          blockers: [{
            id: 'verification-execution:midscene-timeout',
            artifact: 'midscene',
            detail: null
          }],
          timed_out: true,
          canceled: false
        };
      },
      blocker: 'verification-execution:midscene-timeout'
    },
    {
      name: 'cancellation',
      worker: async (payload) => {
        writeWorkerScreenshot(payload);
        return {
          status: 'canceled',
          assertions: [],
          console: [],
          network: [],
          blockers: [{
            id: 'verification-execution:midscene-canceled',
            artifact: 'midscene',
            detail: null
          }],
          timed_out: false,
          canceled: true
        };
      },
      blocker: 'verification-execution:midscene-canceled'
    },
    {
      name: 'worker failure before screenshot',
      worker: async () => ({
        status: 'blocked',
        assertions: [],
        console: [],
        network: [],
        blockers: [{
          id: 'verification-execution:playwright-process-failed',
          artifact: 'playwright-process',
          detail: 'sandbox launch failed'
        }],
        timed_out: false,
        canceled: false
      }),
      blocker: 'verification-execution:playwright-process-failed'
    },
    {
      name: 'missing screenshot',
      worker: async () => ({
        status: 'observed',
        assertions: [],
        console: [],
        network: [],
        blockers: [],
        timed_out: false,
        canceled: false
      }),
      blocker: 'verification-execution:midscene-screenshot-missing'
    }
  ];

  for (const item of cases) {
    const fixture = midsceneExecutionFixture();
    const adapter = adapterFor(item.worker);
    try {
      const result = await adapter.interact(
        midsceneRequest(fixture).midscene,
        {
          runtimeStatus: fixture.runtimeStatus,
          projectRoot: fixture.projectRoot,
          timeoutMs: 100,
          providerEnvironment: PROVIDER_ENV,
          allowedOrigins: fixture.testCase.runner.allowed_origins,
          expectedOracleScenarioHash:
            fixture.testCase.runner.oracle_scenario_hash,
          expectedPromptHash: fixture.testCase.runner.prompt_hash,
          expectedStartUrl: fixture.testCase.runner.start_url,
          oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
          oracleMode: 'deterministic'
        }
      );
      assert.notEqual(result.status, 'passed', item.name);
      assert.equal(result.blockers[0].id, item.blocker, item.name);
      assert.equal(JSON.stringify(result).includes('secret-value'), false);
      assert.equal(result.fallback_used, false);
      if (item.name === 'exception') {
        assert.deepEqual(privateStagingDirectories(fixture), []);
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test('adapter rejects malformed worker results and occupied artifact roots', async () => {
  const fixture = midsceneExecutionFixture();
  let calls = 0;
  const adapter = adapterFor(async () => {
    calls += 1;
    return null;
  });
  const options = {
    runtimeStatus: fixture.runtimeStatus,
    projectRoot: fixture.projectRoot,
    timeoutMs: 100,
    providerEnvironment: PROVIDER_ENV,
    allowedOrigins: fixture.testCase.runner.allowed_origins,
    expectedOracleScenarioHash:
      fixture.testCase.runner.oracle_scenario_hash,
    expectedPromptHash: fixture.testCase.runner.prompt_hash,
    expectedStartUrl: fixture.testCase.runner.start_url,
    oracleAssertionIds: fixture.testCase.runner.oracle_assertion_ids,
    oracleMode: 'deterministic'
  };
  try {
    const malformed = await adapter.interact(
      midsceneRequest(fixture).midscene,
      options
    );
    assert.equal(malformed.status, 'blocked');
    assert.equal(
      malformed.blockers[0].id,
      'verification-execution:midscene-worker-result-invalid'
    );
    assert.equal(calls, 1);
    assert.deepEqual(privateStagingDirectories(fixture), []);

    fs.mkdirSync(fixture.artifactRoot, { recursive: true });
    fs.writeFileSync(path.join(fixture.artifactRoot, 'occupied'), 'data');
    const occupied = await adapter.interact(
      midsceneRequest(fixture).midscene,
      options
    );
    assert.equal(occupied.status, 'blocked');
    assert.equal(
      occupied.blockers[0].id,
      'verification-execution:midscene-artifact-root-invalid'
    );
    assert.equal(calls, 1);
  } finally {
    fixture.cleanup();
  }
});
