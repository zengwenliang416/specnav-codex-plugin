'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const {
  createBrowserAccessPolicy
} = require('./browser-access-policy');
const {
  createPlaywrightApiGuard
} = require('./playwright-api-guard');

const CHILD_MARKER = 'specnav.playwright.child.v1';
const SANDBOX_EXECUTABLE = '/usr/bin/sandbox-exec';
const DEFAULT_SHUTDOWN_GRACE_MS = 1500;
const DEFAULT_KILL_GRACE_MS = 500;

function blocker(id, artifact = 'playwright', detail = null) {
  return { id, artifact, detail };
}

function runnerKind(payload) {
  return payload?.mode === 'midscene' ? 'midscene' : 'playwright';
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function jsonSafe(value) {
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'bigint') return entry.toString();
    if (typeof entry === 'undefined') return null;
    if (typeof entry === 'number' && !Number.isFinite(entry)) {
      return String(entry);
    }
    if (entry instanceof Error) {
      return {
        name: entry.name,
        message: entry.message,
        stack: entry.stack || null
      };
    }
    if (entry && typeof entry === 'object') {
      if (seen.has(entry)) return '[Circular]';
      seen.add(entry);
    }
    return entry;
  }));
}

function stringifyJson(value) {
  return `${JSON.stringify(jsonSafe(value), null, 2)}\n`;
}

class StopError extends Error {
  constructor(kind) {
    super(`playwright ${kind}`);
    this.name = 'StopError';
    this.kind = kind;
  }
}

class AssertionContractError extends Error {
  constructor(id, detail) {
    super(id);
    this.name = 'AssertionContractError';
    this.blocker = blocker(id, 'assertionContracts', detail);
  }
}

function createAssertionApi(contractIds, assertions, emit) {
  const allowed = new Set(contractIds);
  const used = new Set();

  function record(id, method, actual, expected, passed) {
    if (typeof id !== 'string' || !allowed.has(id)) {
      throw new AssertionContractError(
        'verification-execution:playwright-assertion-contract-mismatch',
        typeof id === 'string' ? id : null
      );
    }
    if (used.has(id)) {
      throw new AssertionContractError(
        'verification-execution:playwright-assertion-duplicate',
        id
      );
    }
    used.add(id);
    const assertion = jsonSafe({
      id,
      method,
      actual,
      expected,
      status: passed ? 'passed' : 'failed'
    });
    assertions.push(assertion);
    emit({ type: 'assertion', assertion });
    return passed;
  }

  return Object.freeze({
    equal(id, actual, expected) {
      return record(
        id,
        'equal',
        actual,
        expected,
        isDeepStrictEqual(actual, expected)
      );
    },
    ok(id, actual) {
      return record(id, 'ok', actual, true, !!actual);
    }
  });
}

function loadManagedPlaywright(payload, options = {}) {
  const runtimeRoot = fs.realpathSync(payload.runtime_root);
  let executable = null;
  if (options.validateExecutable !== false) {
    executable = fs.realpathSync(payload.executable);
    if (!isContained(runtimeRoot, executable)) {
      throw new Error('managed Chromium escapes the runtime root');
    }
    fs.accessSync(executable, fs.constants.R_OK | fs.constants.X_OK);
  }

  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(runtimeRoot, 'browsers');
    const runtimeRequire = createRequire(path.join(runtimeRoot, 'package.json'));
    const packageJson = runtimeRequire('playwright/package.json');
    if (packageJson.version !== payload.playwright_version) {
      throw new Error(
        `managed Playwright version mismatch: ${packageJson.version}`
      );
    }
    const playwright = runtimeRequire('playwright');
    if (typeof playwright?.chromium?.launch !== 'function') {
      throw new Error('managed Playwright Chromium launcher is unavailable');
    }
    return { playwright, executable };
  } finally {
    if (previousBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    }
  }
}

function compileScenario(source) {
  const sandbox = {
    AbortController,
    AbortSignal,
    Promise,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    clearImmediate,
    clearInterval,
    clearTimeout,
    console: Object.freeze({
      debug() {},
      error() {},
      info() {},
      log() {},
      warn() {}
    }),
    queueMicrotask,
    setImmediate,
    setInterval,
    setTimeout
  };
  const context = vm.createContext(sandbox, {
    name: 'specnav-playwright-scenario',
    codeGeneration: {
      strings: false,
      wasm: false
    }
  });
  const scenario = new vm.Script(`(${source})`, {
    filename: 'approved-playwright-scenario.js'
  }).runInContext(context, { timeout: 1000 });
  if (typeof scenario !== 'function') {
    throw new Error('approved scenario source did not evaluate to a function');
  }
  return scenario;
}

function workerResult(state, overrides = {}) {
  return {
    ok: false,
    status: 'blocked',
    artifacts: state.artifacts,
    assertions: state.assertions,
    console: state.console,
    network: state.network,
    browser: state.browser,
    observation: state.observation || null,
    exit_status: null,
    signal: null,
    timed_out: false,
    canceled: false,
    spawn_error: null,
    stdout: '',
    stderr: '',
    blockers: [],
    ...overrides
  };
}

function loadManagedMidscene(payload) {
  const runtimeRoot = fs.realpathSync(payload.runtime_root);
  const packageRoot = path.join(
    runtimeRoot,
    'node_modules',
    '@midscene',
    'web'
  );
  const packageFile = fs.realpathSync(path.join(packageRoot, 'package.json'));
  if (!isContained(runtimeRoot, packageFile)) {
    throw new Error('managed Midscene package escapes the runtime root');
  }
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (packageJson.version !== payload.midscene_version) {
    throw new Error(
      `managed Midscene version mismatch: ${packageJson.version}`
    );
  }
  const runtimeRequire = createRequire(packageFile);
  const resolved = fs.realpathSync(
    runtimeRequire.resolve('@midscene/web/playwright')
  );
  if (!isContained(packageRoot, resolved)) {
    throw new Error('managed Midscene entrypoint escapes its package root');
  }
  const moduleValue = runtimeRequire(resolved);
  if (typeof moduleValue?.PlaywrightAgent !== 'function') {
    throw new Error('managed Midscene PlaywrightAgent is unavailable');
  }
  return moduleValue;
}

async function invokeMidsceneAgent(agent, payload, signal) {
  const options = { abortSignal: signal };
  if (payload.interaction.kind === 'tap') {
    return agent.aiTap(payload.prompt, options);
  }
  if (payload.interaction.kind === 'input') {
    return agent.aiInput(payload.prompt, {
      value: payload.interaction.value,
      abortSignal: signal
    });
  }
  if (payload.interaction.kind === 'query') {
    return agent.aiQuery(payload.prompt, options);
  }
  return agent.aiAct(payload.prompt, options);
}

async function executeWorker(payload, options = {}) {
  const state = {
    artifacts: [],
    assertions: [],
    console: [],
    network: [],
    browser: payload.browser,
    observation: null
  };
  if (typeof options.send !== 'function') {
    throw new Error('authenticated Playwright worker sender is required');
  }
  const emit = (event) => options.send({
    type: 'event',
    event: jsonSafe(event)
  });
  const artifactRoot = fs.realpathSync(payload.staging_root);
  const screenshotPath = path.join(artifactRoot, 'screenshot.png');
  const tracePath = path.join(artifactRoot, 'trace.zip');
  const videoPath = path.join(artifactRoot, 'video.webm');
  const consolePath = path.join(artifactRoot, 'console.json');
  const networkPath = path.join(artifactRoot, 'network.json');
  const assertionsPath = path.join(artifactRoot, 'assertions.json');
  let browser = null;
  let context = null;
  let page = null;
  let video = null;
  let tracingStarted = false;
  let scenarioError = null;
  let launchError = null;
  let stopCause = null;
  let rejectStop;
  let accessPolicy = null;
  const accessViolations = [];
  const oracleViolations = [];
  let observationScreenshotCaptured = false;
  const scenarioController = new AbortController();
  const cleanupErrors = [];
  const stopPromise = new Promise((_resolve, reject) => {
    rejectStop = reject;
  });
  stopPromise.catch(() => {});

  function stop(kind) {
    if (stopCause) return;
    stopCause = kind;
    scenarioController.abort(new StopError(kind));
    rejectStop(new StopError(kind));
  }

  process.on('message', (message) => {
    if (
      message?.type === 'stop'
      && ['timeout', 'canceled'].includes(message.kind)
    ) {
      stop(message.kind);
    }
  });

  function registerArtifact(kind, file) {
    try {
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) return;
      state.artifacts.push({ kind, path: file });
    } catch {
      // Missing or partial captures are handled by the parent result.
    }
  }

  function writeJsonArtifact(kind, file, value) {
    try {
      fs.writeFileSync(file, stringifyJson(value), {
        encoding: 'utf8',
        flag: 'w',
        mode: 0o600
      });
      registerArtifact(kind, file);
    } catch (error) {
      cleanupErrors.push({
        file,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  try {
    const managed = loadManagedPlaywright(payload, {
      validateExecutable: false
    });
    const scenario = (
      payload.mode === 'midscene'
      && payload.oracle_mode === 'human_signoff'
    )
      ? null
      : compileScenario(
        payload.mode === 'midscene'
          ? payload.oracle_scenario_source
          : payload.scenario_source
      );
    if (!stopCause) {
      try {
        browser = await Promise.race([
          managed.playwright.chromium.connect(payload.ws_endpoint),
          stopPromise
        ]);
      } catch (error) {
        if (!(error instanceof StopError)) launchError = error;
      }
    }

    if (browser && !stopCause && !launchError) {
      emit({
        type: 'started',
        scenario_id: payload.scenario_id,
        browser: state.browser
      });
      context = await Promise.race([
        browser.newContext({
          recordVideo: {
            dir: artifactRoot
          }
        }),
        stopPromise
      ]);
      accessPolicy = createBrowserAccessPolicy(payload.allowed_origins);
      const denyAccess = (url) => {
        const target = accessPolicy.target(url);
        if (!accessViolations.includes(target)) accessViolations.push(target);
        const entry = {
          phase: 'policy-denied',
          method: null,
          url: target,
          resource_type: 'policy'
        };
        state.network.push(entry);
        emit({ type: 'network', entry });
      };
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (accessPolicy.allows(url)) {
          await route.continue();
          return;
        }
        denyAccess(url);
        await route.abort('blockedbyclient');
      });
      if (typeof context.routeWebSocket === 'function') {
        await context.routeWebSocket('**/*', async (webSocketRoute) => {
          const url = webSocketRoute.url();
          if (accessPolicy.allows(url)) {
            webSocketRoute.connectToServer();
            return;
          }
          denyAccess(url);
          await webSocketRoute.close({
            code: 1008,
            reason: 'blocked by browser access policy'
          });
        });
      }
    }

    if (context && !stopCause && !launchError) {
      await Promise.race([
        context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true
        }),
        stopPromise
      ]);
      tracingStarted = true;

      context.on('console', (message) => {
        const entry = jsonSafe({
          type: message.type(),
          text: message.text(),
          location: message.location()
        });
        state.console.push(entry);
        emit({ type: 'console', entry });
      });
      context.on('request', (requestEvent) => {
        const observedUrl = accessPolicy.allows(requestEvent.url())
          ? requestEvent.url()
          : accessPolicy.target(requestEvent.url());
        const entry = {
          phase: 'request',
          method: requestEvent.method(),
          url: observedUrl,
          resource_type: requestEvent.resourceType()
        };
        state.network.push(entry);
        emit({ type: 'network', entry });
      });
      context.on('response', (response) => {
        const requestEvent = response.request();
        const observedUrl = accessPolicy.allows(response.url())
          ? response.url()
          : accessPolicy.target(response.url());
        const entry = {
          phase: 'response',
          method: requestEvent.method(),
          url: observedUrl,
          resource_type: requestEvent.resourceType(),
          status: response.status(),
          ok: response.ok()
        };
        state.network.push(entry);
        emit({ type: 'network', entry });
      });

      page = await Promise.race([context.newPage(), stopPromise]);
      video = page.video();
      const assertion = createAssertionApi(
        payload.assertion_contract_ids,
        state.assertions,
        emit
      );
      const guarded = createPlaywrightApiGuard({
        browser,
        context,
        page,
        onDenied(detail) {
          if (!accessViolations.includes(detail)) {
            accessViolations.push(detail);
          }
        }
      });
      const oracleGuarded = payload.mode === 'midscene'
        ? createPlaywrightApiGuard({
          browser,
          context,
          page,
          readOnly: true,
          onDenied(detail) {
            if (!oracleViolations.includes(detail)) {
              oracleViolations.push(detail);
            }
          }
        })
        : guarded;
      const scenarioPromise = Promise.resolve().then(async () => {
        if (payload.mode === 'midscene') {
          await page.goto(payload.start_url);
          const { PlaywrightAgent } = loadManagedMidscene(payload);
          const agent = new PlaywrightAgent(page, {
            testId: payload.scenario_id,
            groupName: payload.prompt_id,
            generateReport: false,
            persistExecutionDump: false,
            autoPrintReportMsg: false
          });
          try {
            const response = await invokeMidsceneAgent(
              agent,
              payload,
              scenarioController.signal
            );
            state.observation = jsonSafe({
              description: typeof response === 'string' ? response : null,
              response: response === undefined ? null : response
            });
          } finally {
            if (typeof agent.destroy === 'function') await agent.destroy();
          }
          await page.screenshot({
            path: screenshotPath,
            fullPage: true
          });
          registerArtifact('screenshot', screenshotPath);
          observationScreenshotCaptured = true;
          if (payload.oracle_mode === 'human_signoff') return;
        }
        return scenario({
          page: oracleGuarded.page,
          context: oracleGuarded.context,
          browser: oracleGuarded.browser,
          assertion,
          data: payload.scenario_data,
          signal: scenarioController.signal,
          scenario_id: payload.scenario_id,
          browser_project: payload.browser_project
        });
      });
      try {
        await Promise.race([scenarioPromise, stopPromise]);
      } catch (error) {
        scenarioError = error;
        scenarioPromise.catch(() => {});
      }
    }
  } catch (error) {
    if (!(error instanceof StopError)) scenarioError = error;
  } finally {
    if (page && !page.isClosed() && !observationScreenshotCaptured) {
      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true
        });
        registerArtifact('screenshot', screenshotPath);
      } catch (error) {
        cleanupErrors.push({
          file: screenshotPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (context && tracingStarted) {
      try {
        await context.tracing.stop({ path: tracePath });
        registerArtifact('trace', tracePath);
      } catch (error) {
        cleanupErrors.push({
          file: tracePath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (context) {
      try {
        await context.close();
      } catch (error) {
        cleanupErrors.push({
          file: artifactRoot,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (video) {
      try {
        const recordedPath = await video.path().catch(() => null);
        await video.saveAs(videoPath);
        registerArtifact('video', videoPath);
        if (
          recordedPath
          && recordedPath !== videoPath
          && isContained(artifactRoot, recordedPath)
        ) {
          fs.rmSync(recordedPath, { force: true });
        }
      } catch (error) {
        cleanupErrors.push({
          file: videoPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        cleanupErrors.push({
          file: payload.executable,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    writeJsonArtifact('log', consolePath, state.console);
    writeJsonArtifact('log', networkPath, state.network);
    writeJsonArtifact('assertion_result', assertionsPath, state.assertions);
  }

  if (stopCause === 'canceled') {
    const runner = runnerKind(payload);
    return workerResult(state, {
      status: 'canceled',
      canceled: true,
      blockers: [blocker(
        `verification-execution:${runner}-canceled`,
        runner
      )]
    });
  }
  if (stopCause === 'timeout') {
    const runner = runnerKind(payload);
    return workerResult(state, {
      status: 'failed',
      timed_out: true,
      blockers: [blocker(
        `verification-execution:${runner}-timeout`,
        runner,
        String(payload.timeout_ms)
      )]
    });
  }
  if (launchError) {
    const message = launchError instanceof Error
      ? launchError.message
      : String(launchError);
    return workerResult(state, {
      spawn_error: message,
      stderr: message,
      blockers: [blocker(
        'verification-execution:playwright-launch-failed',
        payload.executable,
        message
      )]
    });
  }
  if (accessViolations.length > 0) {
    return workerResult(state, {
      status: 'blocked',
      exit_status: 1,
      blockers: [blocker(
        'verification-execution:playwright-access-denied',
        payload.scenario_id,
        accessViolations.join(',')
      )]
    });
  }
  if (oracleViolations.length > 0) {
    return workerResult(state, {
      status: 'blocked',
      exit_status: 1,
      blockers: [blocker(
        'verification-execution:midscene-oracle-mutation-denied',
        payload.scenario_id,
        oracleViolations.join(',')
      )]
    });
  }
  if (scenarioError instanceof AssertionContractError) {
    return workerResult(state, {
      stderr: scenarioError.message,
      blockers: [scenarioError.blocker]
    });
  }
  if (scenarioError) {
    const message = scenarioError instanceof Error
      ? scenarioError.message
      : String(scenarioError);
    const runner = runnerKind(payload);
    return workerResult(state, {
      status: 'failed',
      exit_status: 1,
      stderr: message,
      blockers: [blocker(
        `verification-execution:${runner}-${
          runner === 'midscene' ? 'oracle' : 'scenario'
        }-failed`,
        payload.scenario_id,
        message
      )]
    });
  }
  if (cleanupErrors.length > 0) {
    return workerResult(state, {
      stderr: cleanupErrors.map((entry) => (
        `${entry.file}: ${entry.error}`
      )).join('\n'),
      blockers: [blocker(
        'verification-execution:playwright-artifact-capture-failed',
        artifactRoot,
        cleanupErrors.map((entry) => entry.file).join(',')
      )]
    });
  }
  if (
    state.assertions.length === 0
    && (
      payload.mode !== 'midscene'
      || payload.oracle_mode === 'deterministic'
    )
  ) {
    return workerResult(state, {
      blockers: [blocker(
        payload.mode === 'midscene'
          ? 'verification-execution:midscene-oracle-assertion-missing'
          : 'verification-execution:playwright-assertion-missing',
        payload.scenario_id
      )]
    });
  }
  if (payload.mode === 'midscene') {
    return workerResult(state, {
      status: 'observed',
      exit_status: 0,
      blockers: []
    });
  }
  const failedAssertions = state.assertions.filter(
    (entry) => entry.status === 'failed'
  );
  if (failedAssertions.length > 0) {
    return workerResult(state, {
      status: 'failed',
      exit_status: 1,
      blockers: [blocker(
        'verification-execution:playwright-assertion-failed',
        payload.scenario_id,
        failedAssertions.map((entry) => entry.id).join(',')
      )]
    });
  }
  return workerResult(state, {
    ok: true,
    status: 'passed',
    exit_status: 0,
    blockers: []
  });
}

function stoppedResult(payload, partial, kind, detail = null) {
  const runner = runnerKind(payload);
  return workerResult(partial, {
    status: kind === 'canceled' ? 'canceled' : 'failed',
    canceled: kind === 'canceled',
    timed_out: kind === 'timeout',
    blockers: [blocker(
      `verification-execution:${runner}-${kind}`,
      runner,
      detail || (kind === 'timeout' ? String(payload.timeout_ms) : null)
    )]
  });
}

function failedWorkerResult(partial, error) {
  const message = error instanceof Error ? error.message : String(error);
  return workerResult(partial, {
    spawn_error: message,
    stderr: message,
    blockers: [blocker(
      'verification-execution:playwright-process-failed',
      'playwright-process',
      message
    )]
  });
}

function sandboxLiteral(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function sandboxPathAncestors(values) {
  const ancestors = new Set();
  for (const value of values) {
    let current = path.dirname(value);
    while (current !== path.dirname(current)) {
      ancestors.add(current);
      current = path.dirname(current);
    }
  }
  return [...ancestors]
    .sort()
    .map((value) => `  (literal "${sandboxLiteral(value)}")`);
}

function sandboxNetworkRule(wsEndpoint) {
  const endpoint = new URL(wsEndpoint);
  if (
    !['ws:', 'wss:'].includes(endpoint.protocol)
    || !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(endpoint.hostname)
    || !/^\d+$/.test(endpoint.port)
  ) {
    throw new Error('managed Playwright endpoint is not loopback TCP');
  }
  return `(allow network-outbound (remote tcp "localhost:${endpoint.port}"))`;
}

function sandboxProviderNetworkRule(proxyUrl) {
  const endpoint = new URL(proxyUrl);
  if (
    endpoint.protocol !== 'http:'
    || endpoint.username !== ''
    || endpoint.password !== ''
    || endpoint.hash !== ''
    || !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(
      endpoint.hostname
    )
    || !/^\d+$/.test(endpoint.port)
  ) {
    throw new Error('Midscene provider proxy must be explicit loopback HTTP');
  }
  return `(allow network-outbound (remote tcp "localhost:${endpoint.port}"))`;
}

function sandboxProfile(payload) {
  const stagingPath = fs.realpathSync(payload.staging_root);
  const runtimePath = fs.realpathSync(payload.runtime_root);
  const pluginPath = path.resolve(__dirname, '../..');
  const nodePath = fs.realpathSync(process.execPath);
  const stagingRoot = sandboxLiteral(stagingPath);
  const runtimeRoot = sandboxLiteral(runtimePath);
  const pluginRoot = sandboxLiteral(pluginPath);
  const nodeExecutable = sandboxLiteral(nodePath);
  const ancestorRules = sandboxPathAncestors([
    stagingPath,
    runtimePath,
    pluginPath,
    nodePath
  ]);
  return [
    '(version 1)',
    '(deny default)',
    '(allow file-read-data file-test-existence (literal "/"))',
    '(allow file-read-metadata file-test-existence',
    ...ancestorRules,
    ')',
    '(allow file-read*',
    '  (subpath "/System")',
    '  (subpath "/Library")',
    '  (subpath "/usr/lib")',
    '  (subpath "/usr/share")',
    '  (subpath "/private/etc")',
    '  (subpath "/private/var/db/timezone")',
    `  (subpath "${runtimeRoot}")`,
    `  (subpath "${pluginRoot}")`,
    `  (subpath "${stagingRoot}")`,
    `  (literal "${nodeExecutable}")`,
    '  (literal "/dev/null")',
    '  (literal "/dev/random")',
    '  (literal "/dev/urandom"))',
    '(allow file-write*',
    `  (subpath "${stagingRoot}")`,
    '  (literal "/dev/null")',
    '  (literal "/dev/tty"))',
    `(allow process-exec (literal "${nodeExecutable}"))`,
    sandboxNetworkRule(payload.ws_endpoint),
    ...(payload.mode === 'midscene'
      ? [sandboxProviderNetworkRule(payload.provider_proxy_url)]
      : []),
    '(allow sysctl-read)',
    '(allow mach-lookup)'
  ].join('\n');
}

function parseConnectTarget(authority) {
  if (typeof authority !== 'string' || authority.trim() === '') return null;
  try {
    const parsed = new URL(`http://${authority}`);
    if (
      parsed.username !== ''
      || parsed.password !== ''
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
      || !parsed.hostname
      || !/^\d+$/.test(parsed.port)
    ) {
      return null;
    }
    return {
      hostname: parsed.hostname.toLowerCase(),
      port: parsed.port
    };
  } catch {
    return null;
  }
}

function createRestrictedConnectProxy(providerBaseUrl) {
  return new Promise((resolve, reject) => {
    let provider;
    try {
      provider = new URL(providerBaseUrl);
      if (
        provider.protocol !== 'https:'
        || provider.username !== ''
        || provider.password !== ''
        || provider.hash !== ''
      ) {
        throw new Error('provider base URL is not explicit HTTPS');
      }
    } catch (error) {
      reject(error);
      return;
    }

    const expected = {
      hostname: provider.hostname.toLowerCase(),
      port: provider.port || '443'
    };
    const sockets = new Set();
    const server = http.createServer((_request, response) => {
      response.writeHead(405, {
        connection: 'close',
        'content-type': 'text/plain; charset=utf-8'
      });
      response.end('CONNECT required\n');
    });

    function track(socket) {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    }

    server.on('connect', (request, clientSocket, head) => {
      track(clientSocket);
      const target = parseConnectTarget(request.url);
      if (
        !target
        || target.hostname !== expected.hostname
        || target.port !== expected.port
      ) {
        clientSocket.end([
          'HTTP/1.1 403 Forbidden',
          'Connection: close',
          'Content-Length: 0',
          '',
          ''
        ].join('\r\n'));
        return;
      }

      const upstream = net.connect({
        host: expected.hostname,
        port: Number(expected.port)
      });
      track(upstream);
      upstream.once('connect', () => {
        clientSocket.write([
          'HTTP/1.1 200 Connection Established',
          'Proxy-Agent: SpecNav',
          '',
          ''
        ].join('\r\n'));
        if (head.length > 0) upstream.write(head);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });
      upstream.once('error', () => {
        if (!clientSocket.destroyed) {
          clientSocket.end([
            'HTTP/1.1 502 Bad Gateway',
            'Connection: close',
            'Content-Length: 0',
            '',
            ''
          ].join('\r\n'));
        }
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        async close() {
          for (const socket of sockets) socket.destroy();
          await new Promise((closeResolve, closeReject) => {
            server.close((error) => (
              error ? closeReject(error) : closeResolve()
            ));
          });
        }
      });
    });
  });
}

function signalProcessGroup(child, signal) {
  if (!Number.isInteger(child.pid) || child.pid <= 0) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Exit observation decides whether a stronger signal is required.
    }
  }
}

function removeControlArtifacts(stagingRoot) {
  for (const name of [
    '.specnav-playwright-payload.json',
    '.specnav-process-home',
    '.specnav-process-tmp'
  ]) {
    fs.rmSync(path.join(stagingRoot, name), {
      recursive: true,
      force: true
    });
  }
}

function runSandboxedScenario(payload, options = {}) {
  return new Promise((resolve) => {
    const partial = {
      artifacts: [],
      assertions: [],
      console: [],
      network: [],
      browser: payload.browser
    };
    let profile;
    let payloadFile;
    let child;
    const ipcNonce = crypto.randomBytes(32).toString('hex');
    try {
      const sandboxInfo = fs.statSync(SANDBOX_EXECUTABLE);
      if (!sandboxInfo.isFile()) {
        throw new Error('sandbox-exec is not a file');
      }
      fs.accessSync(
        SANDBOX_EXECUTABLE,
        fs.constants.R_OK | fs.constants.X_OK
      );
      profile = sandboxProfile(payload);
      payloadFile = path.join(
        payload.staging_root,
        '.specnav-playwright-payload.json'
      );
      const childHome = path.join(
        payload.staging_root,
        '.specnav-process-home'
      );
      const childTmp = path.join(
        payload.staging_root,
        '.specnav-process-tmp'
      );
      fs.mkdirSync(childHome, { mode: 0o700 });
      fs.mkdirSync(childTmp, { mode: 0o700 });
      fs.writeFileSync(payloadFile, stringifyJson(payload), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      child = spawn(SANDBOX_EXECUTABLE, [
        '-p',
        profile,
        process.execPath,
        __filename,
        payloadFile
      ], {
        cwd: payload.staging_root,
        detached: true,
        env: {
          HOME: childHome,
          LANG: process.env.LANG || 'en_US.UTF-8',
          LC_ALL: process.env.LC_ALL || '',
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          SPECNAV_PLAYWRIGHT_CHILD: CHILD_MARKER,
          TMPDIR: childTmp,
          ...(payload.mode === 'midscene'
            ? options.providerEnvironment
            : {})
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });
      child.send({
        type: 'specnav-playwright-init',
        nonce: ipcNonce
      });
    } catch (error) {
      removeControlArtifacts(payload.staging_root);
      resolve(failedWorkerResult(partial, error));
      return;
    }

    const shutdownGraceMs = Number.isInteger(options.shutdownGraceMs)
      && options.shutdownGraceMs > 0
      ? options.shutdownGraceMs
      : DEFAULT_SHUTDOWN_GRACE_MS;
    const killGraceMs = Number.isInteger(options.killGraceMs)
      && options.killGraceMs > 0
      ? options.killGraceMs
      : DEFAULT_KILL_GRACE_MS;
    let terminal = false;
    let stopCause = null;
    let timeout = null;
    let forcedStop = null;
    let abortListener = null;
    let exited = false;
    let exitCode = null;
    let exitSignal = null;
    let stdout = '';
    let stderr = '';
    let resolveExit;
    const exitPromise = new Promise((resolveChildExit) => {
      resolveExit = resolveChildExit;
    });

    function cleanupSignals() {
      if (timeout) clearTimeout(timeout);
      if (forcedStop) clearTimeout(forcedStop);
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener);
      }
    }

    async function stopProcessGroup() {
      if (exited) return;
      signalProcessGroup(child, 'SIGTERM');
      await Promise.race([
        exitPromise,
        new Promise((resolveDelay) => setTimeout(resolveDelay, killGraceMs))
      ]);
      if (!exited) {
        signalProcessGroup(child, 'SIGKILL');
        await exitPromise;
      }
    }

    async function complete(result) {
      if (terminal) return;
      terminal = true;
      cleanupSignals();
      await stopProcessGroup();
      removeControlArtifacts(payload.staging_root);
      const captured = [result.stderr, stderr]
        .filter((entry) => typeof entry === 'string' && entry.length > 0)
        .join('\n');
      const resolvedResult = {
        ...result,
        stdout: [result.stdout, stdout]
          .filter((entry) => typeof entry === 'string' && entry.length > 0)
          .join('\n'),
        stderr: captured
      };
      resolve(stopCause
        ? stoppedResult(payload, {
          ...partial,
          ...resolvedResult,
          artifacts: resolvedResult.artifacts || partial.artifacts,
          assertions: resolvedResult.assertions || partial.assertions,
          console: resolvedResult.console || partial.console,
          network: resolvedResult.network || partial.network,
          browser: resolvedResult.browser || partial.browser
        }, stopCause)
        : resolvedResult);
    }

    function requestStop(kind) {
      if (terminal || stopCause) return;
      stopCause = kind;
      if (child.connected) child.send({ type: 'stop', kind });
      forcedStop = setTimeout(() => {
        complete(stoppedResult(
          payload,
          partial,
          kind,
          'process shutdown grace exceeded'
        ));
      }, shutdownGraceMs);
    }

    if (Number.isInteger(payload.timeout_ms) && payload.timeout_ms > 0) {
      timeout = setTimeout(() => requestStop('timeout'), payload.timeout_ms);
    }
    if (options.signal) {
      abortListener = () => requestStop('canceled');
      options.signal.addEventListener('abort', abortListener, { once: true });
      if (options.signal.aborted) requestStop('canceled');
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('message', (message) => {
      if (message?.nonce !== ipcNonce) return;
      if (message?.type === 'event') {
        const event = message.event;
        if (event?.type === 'assertion') partial.assertions.push(event.assertion);
        if (event?.type === 'console') partial.console.push(event.entry);
        if (event?.type === 'network') partial.network.push(event.entry);
        if (typeof options.onEvent === 'function') options.onEvent(event);
        return;
      }
      if (message?.type === 'result') {
        complete(message.result);
      }
    });
    child.once('error', (error) => {
      complete(stopCause
        ? stoppedResult(payload, partial, stopCause)
        : failedWorkerResult(partial, error));
    });
    child.once('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      resolveExit();
      if (terminal) return;
      if (stopCause) {
        complete(stoppedResult(payload, partial, stopCause));
        return;
      }
      complete(failedWorkerResult(
        partial,
        new Error(
          `Playwright process exited before result with code ${exitCode}`
          + ` signal ${exitSignal || 'none'}`
        )
      ));
    });
  });
}

async function closeBrowserServer(server) {
  if (!server) return;
  try {
    await server.close();
  } catch {
    if (typeof server.kill === 'function') {
      try {
        await server.kill();
      } catch {
        // The managed browser process may already have exited.
      }
    }
  }
}

async function runPlaywrightWorker(payload, options = {}) {
  const startedAt = Date.now();
  const partial = {
    artifacts: [],
    assertions: [],
    console: [],
    network: [],
    browser: payload.browser
  };
  let stopCause = null;
  let timeout = null;
  let abortListener = null;
  let rejectStop;
  const stopPromise = new Promise((_resolve, reject) => {
    rejectStop = reject;
  });
  stopPromise.catch(() => {});

  function stop(kind) {
    if (stopCause) return;
    stopCause = kind;
    rejectStop(new StopError(kind));
  }

  if (Number.isInteger(payload.timeout_ms) && payload.timeout_ms > 0) {
    timeout = setTimeout(() => stop('timeout'), payload.timeout_ms);
  }
  if (options.signal) {
    abortListener = () => stop('canceled');
    options.signal.addEventListener('abort', abortListener, { once: true });
    if (options.signal.aborted) stop('canceled');
  }

  let browserServer = null;
  let providerProxy = null;
  let launchError = null;
  const managed = loadManagedPlaywright(payload);
  const launchPromise = managed.playwright.chromium.launchServer({
    args: [
      `--crash-dumps-dir=${path.join(payload.staging_root, 'crash-dumps')}`,
      '--disable-crash-reporter',
      '--noerrdialogs'
    ],
    executablePath: managed.executable,
    headless: true,
    timeout: payload.timeout_ms
  });
  try {
    browserServer = await Promise.race([launchPromise, stopPromise]);
  } catch (error) {
    if (!(error instanceof StopError)) launchError = error;
  }

  if (timeout) clearTimeout(timeout);
  if (options.signal && abortListener) {
    options.signal.removeEventListener('abort', abortListener);
  }

  if (stopCause) {
    launchPromise.then(closeBrowserServer, () => {});
    return stoppedResult(payload, partial, stopCause);
  }
  if (launchError) {
    return failedWorkerResult(partial, launchError);
  }

  const elapsed = Date.now() - startedAt;
  const remainingTimeout = Number.isInteger(payload.timeout_ms)
    ? Math.max(1, payload.timeout_ms - elapsed)
    : payload.timeout_ms;
  try {
    if (payload.mode === 'midscene') {
      providerProxy = await createRestrictedConnectProxy(
        payload.provider_base_url
      );
    }
    return await runSandboxedScenario({
      ...payload,
      ...(providerProxy
        ? { provider_proxy_url: providerProxy.url }
        : {}),
      timeout_ms: remainingTimeout,
      ws_endpoint: browserServer.wsEndpoint()
    }, {
      ...options,
      ...(providerProxy
        ? {
          providerEnvironment: {
            ...options.providerEnvironment,
            MIDSCENE_MODEL_HTTP_PROXY: providerProxy.url
          }
        }
        : {})
    });
  } finally {
    if (providerProxy) await providerProxy.close();
    await closeBrowserServer(browserServer);
  }
}

if (process.env.SPECNAV_PLAYWRIGHT_CHILD === CHILD_MARKER) {
  let childPayload = null;
  try {
    childPayload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
  if (childPayload) {
    process.once('message', (message) => {
      if (
        message?.type !== 'specnav-playwright-init'
        || typeof message.nonce !== 'string'
        || !/^[a-f0-9]{64}$/.test(message.nonce)
        || typeof process.send !== 'function'
      ) {
        process.stderr.write('invalid Playwright worker IPC initialization\n');
        process.exitCode = 1;
        return;
      }
      const nonce = message.nonce;
      const trustedSend = process.send.bind(process);
      const send = (value) => trustedSend({
        ...value,
        nonce
      });
      executeWorker(childPayload, { send }).then(
        (result) => send({
          type: 'result',
          result: jsonSafe(result)
        }),
        (error) => send({
          type: 'result',
          result: failedWorkerResult({
            artifacts: [],
            assertions: [],
            console: [],
            network: [],
            browser: childPayload.browser,
            observation: null
          }, error)
        })
      );
    });
  }
}

module.exports = {
  createRestrictedConnectProxy,
  parseConnectTarget,
  sandboxProviderNetworkRule,
  runPlaywrightWorker
};
