'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const {
  createBrowserAccessPolicy
} = require('../execution/browser-access-policy');
const {
  serializePlaywrightScenario
} = require('../execution/playwright-scenario');
const {
  runPlaywrightWorker
} = require('../execution/playwright-worker');

const PRODUCER = 'playwright-runner';

function playwrightBlocker(id, artifact = 'playwright', detail = null) {
  return { id, artifact, detail };
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function nearestExistingAncestor(value) {
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  try {
    return fs.realpathSync(current);
  } catch {
    return null;
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

function validatePlaywrightRequest(request) {
  const blockers = [];
  if (!isObject(request)) {
    return {
      ok: false,
      blockers: [playwrightBlocker(
        'verification-execution:playwright-request-invalid'
      )]
    };
  }
  if (
    typeof request.scenario_id !== 'string'
    || request.scenario_id.trim() === ''
  ) {
    blockers.push(playwrightBlocker(
      'verification-execution:playwright-scenario-id-invalid',
      'scenario_id'
    ));
  }
  if (
    typeof request.scenario_hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(request.scenario_hash)
  ) {
    blockers.push(playwrightBlocker(
      'verification-execution:playwright-scenario-hash-invalid',
      'scenario_hash'
    ));
  }
  if (request.browser_project !== 'chromium') {
    blockers.push(playwrightBlocker(
      'verification-execution:playwright-browser-project-unsupported',
      'browser_project',
      request.browser_project || null
    ));
  }
  if (
    typeof request.artifact_root !== 'string'
    || !path.isAbsolute(request.artifact_root)
  ) {
    blockers.push(playwrightBlocker(
      'verification-execution:playwright-artifact-root-invalid',
      'artifact_root'
    ));
  } else if (
    fs.existsSync(request.artifact_root)
    && !directoryIsEmpty(request.artifact_root)
  ) {
    blockers.push(playwrightBlocker(
      'verification-execution:playwright-artifact-root-nonempty',
      request.artifact_root
    ));
  }
  if (typeof request.scenario !== 'function') {
    blockers.push(playwrightBlocker(
      'verification-execution:playwright-scenario-required',
      'scenario'
    ));
  }
  try {
    createBrowserAccessPolicy(request.allowed_origins);
  } catch {
    blockers.push(playwrightBlocker(
      'verification-execution:playwright-allowed-origins-invalid',
      'allowed_origins'
    ));
  }
  return {
    ok: blockers.length === 0,
    blockers
  };
}

function validateArtifactRoot(artifactRoot, projectRoot) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    return [playwrightBlocker(
      'verification-execution:playwright-project-root-invalid',
      'projectRoot'
    )];
  }

  const resolvedProject = path.resolve(projectRoot);
  const resolvedArtifact = path.resolve(artifactRoot);
  let canonicalProject;
  try {
    canonicalProject = fs.realpathSync(resolvedProject);
    if (!fs.statSync(canonicalProject).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch (error) {
    return [playwrightBlocker(
      'verification-execution:playwright-project-root-unresolvable',
      resolvedProject,
      error instanceof Error ? error.message : String(error)
    )];
  }

  if (
    resolvedArtifact === resolvedProject
    || !isContained(resolvedProject, resolvedArtifact)
  ) {
    return [playwrightBlocker(
      'verification-execution:playwright-artifact-root-outside-project',
      resolvedArtifact
    )];
  }

  const canonicalAncestor = nearestExistingAncestor(resolvedArtifact);
  if (
    !canonicalAncestor
    || !isContained(canonicalProject, canonicalAncestor)
  ) {
    return [playwrightBlocker(
      'verification-execution:playwright-artifact-root-outside-project',
      canonicalAncestor || resolvedArtifact
    )];
  }

  if (fs.existsSync(resolvedArtifact) && !directoryIsEmpty(resolvedArtifact)) {
    return [playwrightBlocker(
      'verification-execution:playwright-artifact-root-nonempty',
      resolvedArtifact
    )];
  }

  return [];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveManagedRuntime(runtimeStatus) {
  if (
    !isObject(runtimeStatus)
    || runtimeStatus.ok !== true
    || runtimeStatus.readiness !== 'ready'
    || runtimeStatus.fallback_used !== false
    || typeof runtimeStatus.runtime_root !== 'string'
    || !path.isAbsolute(runtimeStatus.runtime_root)
  ) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-runtime-not-ready',
        'runtimeStatus'
      )]
    };
  }

  let runtimeRoot;
  try {
    runtimeRoot = fs.realpathSync(runtimeStatus.runtime_root);
    if (!fs.statSync(runtimeRoot).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch (error) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-runtime-root-unresolvable',
        runtimeStatus.runtime_root,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }

  const browserCheck = runtimeStatus.checks?.browsers?.find(
    (entry) => entry?.name === 'chromium'
  );
  if (
    runtimeStatus.checks?.runtime?.ok !== true
    || runtimeStatus.checks?.receipt?.ok !== true
    || !browserCheck
    || browserCheck.marker_exists !== true
    || browserCheck.executable_exists !== true
    || browserCheck.executable_allowed !== true
    || browserCheck.probe_ok !== true
  ) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-runtime-not-doctor-verified',
        runtimeRoot
      )]
    };
  }

  const receiptFile = path.join(runtimeRoot, 'install-receipt.json');
  let receipt;
  try {
    receipt = readJson(receiptFile);
  } catch (error) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-runtime-receipt-unreadable',
        receiptFile,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }

  if (
    receipt.schema !== 'specnav.verification.runtime-install-receipt.v1'
    || receipt.status !== 'installed'
    || receipt.fallback_used !== false
    || receipt.runtime_version !== runtimeStatus.runtime_version
  ) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-runtime-receipt-mismatch',
        receiptFile
      )]
    };
  }

  const playwrightPackage = receipt.packages?.find(
    (entry) => entry?.name === 'playwright'
  );
  if (
    !playwrightPackage
    || typeof playwrightPackage.version !== 'string'
    || playwrightPackage.integrity_verified !== true
  ) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-runtime-package-unverified',
        receiptFile
      )]
    };
  }

  const chromiumReceipt = receipt.browsers?.find(
    (entry) => entry?.name === 'chromium'
  );
  const ffmpegReceipt = receipt.browsers?.find(
    (entry) => entry?.name === 'ffmpeg'
  );
  if (
    !chromiumReceipt
    || chromiumReceipt.integrity_verified !== true
    || typeof chromiumReceipt.executable !== 'string'
    || chromiumReceipt.executable.trim() === ''
    || path.isAbsolute(chromiumReceipt.executable)
  ) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-chromium-receipt-invalid',
        receiptFile
      )]
    };
  }
  if (
    !ffmpegReceipt
    || ffmpegReceipt.integrity_verified !== true
    || typeof ffmpegReceipt.executable !== 'string'
    || ffmpegReceipt.executable.trim() === ''
    || path.isAbsolute(ffmpegReceipt.executable)
  ) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-ffmpeg-receipt-invalid',
        receiptFile
      )]
    };
  }

  const executableCandidate = path.resolve(
    runtimeRoot,
    chromiumReceipt.executable
  );
  const ffmpegCandidate = path.resolve(runtimeRoot, ffmpegReceipt.executable);
  if (!isContained(runtimeRoot, executableCandidate)) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-chromium-outside-runtime',
        chromiumReceipt.executable
      )]
    };
  }
  if (!isContained(runtimeRoot, ffmpegCandidate)) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-ffmpeg-outside-runtime',
        ffmpegReceipt.executable
      )]
    };
  }

  let executable;
  let ffmpeg;
  try {
    executable = fs.realpathSync(executableCandidate);
    if (!isContained(runtimeRoot, executable)) {
      throw new Error('resolved executable escapes runtime root');
    }
    fs.accessSync(executable, fs.constants.R_OK | fs.constants.X_OK);
    if (!fs.statSync(executable).isFile()) {
      throw new Error('not a file');
    }
  } catch (error) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-chromium-unavailable',
        executableCandidate,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
  try {
    ffmpeg = fs.realpathSync(ffmpegCandidate);
    if (!isContained(runtimeRoot, ffmpeg)) {
      throw new Error('resolved ffmpeg escapes runtime root');
    }
    fs.accessSync(ffmpeg, fs.constants.R_OK | fs.constants.X_OK);
    if (!fs.statSync(ffmpeg).isFile()) {
      throw new Error('not a file');
    }
  } catch (error) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-ffmpeg-unavailable',
        ffmpegCandidate,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }

  let playwright;
  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(runtimeRoot, 'browsers');
    const runtimeRequire = createRequire(path.join(runtimeRoot, 'package.json'));
    const packageJson = runtimeRequire('playwright/package.json');
    if (packageJson.version !== playwrightPackage.version) {
      throw new Error(
        `version mismatch: ${packageJson.version} != ${playwrightPackage.version}`
      );
    }
    playwright = runtimeRequire('playwright');
    if (typeof playwright?.chromium?.launch !== 'function') {
      throw new Error('managed playwright chromium launcher is unavailable');
    }
  } catch (error) {
    return {
      blockers: [playwrightBlocker(
        'verification-execution:playwright-runtime-load-failed',
        runtimeRoot,
        error instanceof Error ? error.message : String(error)
      )]
    };
  } finally {
    if (previousBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    }
  }

  return {
    blockers: [],
    playwright,
    runtimeRoot,
    executable,
    ffmpeg,
    receipt,
    chromiumReceipt,
    ffmpegReceipt,
    playwrightPackage
  };
}

function assertionContractIds(contracts) {
  if (contracts instanceof Set) {
    return new Set([...contracts].filter((entry) => typeof entry === 'string'));
  }
  if (contracts instanceof Map) {
    return new Set(
      [...contracts.keys()].filter((entry) => typeof entry === 'string')
    );
  }
  if (Array.isArray(contracts)) {
    return new Set(contracts.map((entry) => (
      typeof entry === 'string' ? entry : entry?.id
    )).filter((entry) => typeof entry === 'string' && entry.length > 0));
  }
  if (isObject(contracts)) {
    return new Set(Object.keys(contracts));
  }
  return new Set();
}

function stringifyJson(value) {
  const seen = new WeakSet();
  return `${JSON.stringify(value, (_key, entry) => {
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
  }, 2)}\n`;
}

function createResult(state, overrides = {}) {
  return {
    ok: false,
    status: 'blocked',
    artifacts: state.artifacts,
    assertions: state.assertions,
    console: state.console,
    network: state.network,
    browser: state.browser,
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

function cloneScenarioData(value) {
  try {
    return { value: structuredClone(value === undefined ? null : value) };
  } catch (error) {
    return {
      blocker: playwrightBlocker(
        'verification-execution:playwright-scenario-data-invalid',
        'scenario_data',
        error instanceof Error ? error.message : String(error)
      )
    };
  }
}

function prepareArtifactWorkspace(artifactRoot, projectRoot) {
  const resolvedArtifact = path.resolve(artifactRoot);
  let canonicalProject;
  let canonicalParent;
  try {
    canonicalProject = fs.realpathSync(path.resolve(projectRoot));
    const requestedParent = path.dirname(resolvedArtifact);
    fs.mkdirSync(requestedParent, {
      recursive: true,
      mode: 0o700
    });
    canonicalParent = fs.realpathSync(requestedParent);
    if (!isContained(canonicalProject, canonicalParent)) {
      throw new Error('artifact parent escapes project root');
    }
  } catch (error) {
    return {
      blocker: playwrightBlocker(
        'verification-execution:playwright-artifact-root-unavailable',
        resolvedArtifact,
        error instanceof Error ? error.message : String(error)
      )
    };
  }

  const destination = path.join(
    canonicalParent,
    path.basename(resolvedArtifact)
  );
  if (
    destination === canonicalProject
    || !isContained(canonicalProject, destination)
  ) {
    return {
      blocker: playwrightBlocker(
        'verification-execution:playwright-artifact-root-outside-project',
        destination
      )
    };
  }

  try {
    if (fs.existsSync(destination) && !directoryIsEmpty(destination)) {
      return {
        blocker: playwrightBlocker(
          'verification-execution:playwright-artifact-root-nonempty',
          destination
        )
      };
    }
    const stagingRoot = fs.mkdtempSync(path.join(
      canonicalParent,
      `.${path.basename(destination)}.staging-`
    ));
    fs.chmodSync(stagingRoot, 0o700);
    return {
      canonicalProject,
      destination,
      stagingRoot
    };
  } catch (error) {
    return {
      blocker: playwrightBlocker(
        'verification-execution:playwright-artifact-root-unavailable',
        destination,
        error instanceof Error ? error.message : String(error)
      )
    };
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function publishArtifacts(workspace, state, emit, options = {}) {
  const producer = options.producer || PRODUCER;
  const jsonArtifacts = [
    ['log', 'console.json', state.console],
    ['log', 'network.json', state.network],
    ['assertion_result', 'assertions.json', state.assertions]
  ];
  try {
    for (const [_kind, name, value] of jsonArtifacts) {
      fs.writeFileSync(
        path.join(workspace.stagingRoot, name),
        stringifyJson(value),
        {
          encoding: 'utf8',
          flag: 'w',
          mode: 0o600
        }
      );
    }

    const canonicalStaging = fs.realpathSync(workspace.stagingRoot);
    if (
      canonicalStaging === workspace.canonicalProject
      || !isContained(workspace.canonicalProject, canonicalStaging)
    ) {
      throw new Error('private staging directory escaped project root');
    }

    fs.renameSync(workspace.stagingRoot, workspace.destination);
    const canonicalDestination = fs.realpathSync(workspace.destination);
    if (
      canonicalDestination !== workspace.destination
      || !isContained(workspace.canonicalProject, canonicalDestination)
    ) {
      throw new Error('published artifact directory is not canonical');
    }

    const candidates = [
      ['screenshot', 'screenshot.png'],
      ['video', 'video.webm'],
      ['trace', 'trace.zip'],
      ['log', 'console.json'],
      ['log', 'network.json'],
      ['assertion_result', 'assertions.json']
    ];
    const artifacts = [];
    for (const [kind, name] of candidates) {
      const file = path.join(canonicalDestination, name);
      if (!fs.existsSync(file)) continue;
      const info = fs.lstatSync(file);
      const canonicalFile = fs.realpathSync(file);
      if (
        info.isSymbolicLink()
        || !info.isFile()
        || info.size === 0
        || !isContained(canonicalDestination, canonicalFile)
      ) {
        throw new Error(`invalid published artifact: ${name}`);
      }
      const artifact = {
        kind,
        path: canonicalFile,
        producer,
        sha256: sha256File(canonicalFile),
        size: info.size
      };
      artifacts.push(artifact);
      emit({ type: 'artifact', artifact });
    }
    return { artifacts };
  } catch (error) {
    return {
      blocker: playwrightBlocker(
        'verification-execution:playwright-artifact-publish-failed',
        workspace.destination,
        error instanceof Error ? error.message : String(error)
      )
    };
  }
}

function createPlaywrightAdapter(factoryOptions = {}) {
  async function execute(request, executeOptions = {}) {
    const options = { ...factoryOptions, ...executeOptions };
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

    function emit(event) {
      try {
        onEvent(event);
      } catch {
        // Event observers do not control the browser attempt.
      }
    }

    function finish(overrides) {
      const result = createResult(state, overrides);
      emit({ type: 'terminal', result });
      return result;
    }

    const validation = validatePlaywrightRequest(request);
    if (!validation.ok) {
      return finish({ blockers: validation.blockers });
    }

    const artifactProblems = validateArtifactRoot(
      request.artifact_root,
      options.projectRoot
    );
    if (artifactProblems.length > 0) {
      return finish({ blockers: artifactProblems });
    }

    const runtime = resolveManagedRuntime(options.runtimeStatus);
    if (runtime.blockers.length > 0) {
      return finish({ blockers: runtime.blockers });
    }

    const scenario = serializePlaywrightScenario(request.scenario);
    if (scenario.blocker) {
      return finish({ blockers: [scenario.blocker] });
    }
    if (
      scenario.hash !== request.scenario_hash
      || scenario.hash !== options.expectedScenarioHash
    ) {
      return finish({ blockers: [playwrightBlocker(
        'verification-execution:playwright-scenario-hash-mismatch',
        request.scenario_id,
        scenario.hash
      )] });
    }
    if (!sameStrings(request.allowed_origins, options.allowedOrigins)) {
      return finish({ blockers: [playwrightBlocker(
        'verification-execution:playwright-allowed-origins-mismatch',
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
      return finish({ blockers: [workspace.blocker] });
    }

    state.browser = {
      project: 'chromium',
      executable: runtime.executable,
      browser_version: runtime.chromiumReceipt.browser_version || null,
      revision: runtime.chromiumReceipt.revision || null,
      playwright_version: runtime.playwrightPackage.version,
      runtime_root: runtime.runtimeRoot
    };

    const workerResult = await runPlaywrightWorker({
      assertion_contract_ids: [...assertionContractIds(
        options.assertionContracts
      )],
      allowed_origins: [...options.allowedOrigins],
      browser: state.browser,
      browser_project: request.browser_project,
      executable: runtime.executable,
      playwright_version: runtime.playwrightPackage.version,
      runtime_root: runtime.runtimeRoot,
      scenario_data: scenarioData.value,
      scenario_hash: scenario.hash,
      scenario_id: request.scenario_id,
      scenario_source: scenario.source,
      staging_root: workspace.stagingRoot,
      timeout_ms: options.timeoutMs
    }, {
      signal: options.signal,
      onEvent: emit
    });

    state.assertions = Array.isArray(workerResult.assertions)
      ? workerResult.assertions
      : [];
    state.console = Array.isArray(workerResult.console)
      ? workerResult.console
      : [];
    state.network = Array.isArray(workerResult.network)
      ? workerResult.network
      : [];

    const published = publishArtifacts(workspace, state, emit);
    if (published.blocker) {
      const blockers = [
        ...(Array.isArray(workerResult.blockers)
          ? workerResult.blockers
          : []),
        published.blocker
      ];
      return finish({
        ...workerResult,
        ok: false,
        status: workerResult.status === 'passed'
          ? 'blocked'
          : workerResult.status,
        artifacts: [],
        blockers
      });
    }
    state.artifacts = published.artifacts;

    return finish({
      ...workerResult,
      artifacts: state.artifacts,
      assertions: state.assertions,
      console: state.console,
      network: state.network
    });
  }

  return Object.freeze({
    validate: validatePlaywrightRequest,
    execute
  });
}

module.exports = {
  createPlaywrightAdapter,
  prepareArtifactWorkspace,
  publishArtifacts,
  resolveManagedRuntime,
  validateArtifactRoot
};
