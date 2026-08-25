#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const kernel = require('../kernel');
const {
  createTrustedFactAuthority
} = require('../kernel/repair/trusted-fact-authority');
const {
  createAuthorityLog
} = require('../kernel/repair/authority-log');
const {
  loadProviderEnvironment
} = require('../kernel/runtime/scope-resolver');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function blocked(id, artifact, detail = null, extra = {}) {
  return {
    ok: false,
    status: 'blocked',
    blockers: [blocker(id, artifact, detail)],
    fallback_used: false,
    ...extra
  };
}

function readJson(file, id) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const failure = new Error(id);
    failure.blockers = [blocker(
      id,
      file,
      error instanceof Error ? error.message : String(error)
    )];
    throw failure;
  }
}

function resolveRepairIdentity(context, authority, failureId) {
  if (
    typeof failureId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(failureId)
  ) {
    return blocked(
      'verification-production:repair-identity-failure-invalid',
      failureId || 'failure-id'
    );
  }
  const store = kernel.createVerificationArtifactStore({
    changeRoot: context.changeRoot,
    root: context.verificationRoot
  });
  const authorityLog = createAuthorityLog({ store, authority });
  const repairRoot = path.posix.join('repairs', failureId);
  const rebinds = authorityLog.validate(
    path.posix.join(repairRoot, 'repair-generation-rebinds.jsonl'),
    'repair_rebind'
  );
  const recoveries = authorityLog.validate(
    path.posix.join(repairRoot, 'repair-lineage-recoveries.jsonl'),
    'repair_recovery'
  );
  if (!rebinds.ok || !recoveries.ok) {
    return {
      ok: false,
      status: 'blocked',
      blockers: [
        ...(rebinds.blockers || []),
        ...(recoveries.blockers || [])
      ],
      fallback_used: false
    };
  }
  const rebind = rebinds.value.at(-1)?.payload;
  const recovery = recoveries.value.at(-1)?.payload;
  let link = rebind?.rebound_repair_link
    || recovery?.recovered_repair_link
    || null;
  if (!link) {
    const completedFile = path.posix.join(
      repairRoot,
      'repair-link-completed-envelope.json'
    );
    const completed = store.readJson(completedFile);
    if (!completed.ok) {
      return blocked(
        'verification-production:repair-identity-unavailable',
        failureId
      );
    }
    if (
      !authority.verify(completed.value).ok
      || completed.value.kind !== 'repair_link'
    ) {
      return blocked(
        'verification-production:repair-identity-untrusted',
        failureId
      );
    }
    link = completed.value.payload;
  }
  const validated = context.schemaRegistry.validate('repair-link', link);
  if (
    !validated.ok
    || validated.value.failure_id !== failureId
    || validated.value.change_id !== context.changeId
    || validated.value.status !== 'completed'
    || !validated.value.after_identity
  ) {
    return blocked(
      'verification-production:repair-identity-invalid',
      failureId
    );
  }
  return {
    ok: true,
    identity: validated.value.after_identity,
    repair_link_id: validated.value.id,
    blockers: [],
    fallback_used: false
  };
}

function git(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function normalizeRelative(value) {
  return String(value).split(path.sep).join('/').replace(/^\.\//, '');
}

function isLifecyclePath(relativePath, changeId) {
  const normalized = normalizeRelative(relativePath);
  const changePrefix = `openspec/changes/${changeId}/`;
  return (
    normalized.startsWith('openspec/.specnav/')
    || ['development/', 'verify/', 'codegraph/', 'operations/']
      .some((directory) => normalized.startsWith(
        `${changePrefix}${directory}`
      ))
    || normalized.startsWith(`${changePrefix}verify-report.`)
    || normalized === `${changePrefix}tasks.md`
  );
}

function dirtyImplementationPaths(projectRoot, changeId) {
  const changed = new Set([
    ...git(projectRoot, [
      'diff',
      '--name-only',
      'HEAD',
      '--'
    ]).split(/\r?\n/),
    ...git(projectRoot, [
      'ls-files',
      '--others',
      '--exclude-standard'
    ]).split(/\r?\n/)
  ].filter(Boolean));
  return [...changed].filter((relativePath) => (
    !changeId || !isLifecyclePath(relativePath, changeId)
  ));
}

function fingerprints(
  projectRoot,
  snapshot,
  runtimeStatus,
  runtimeAuthority = null,
  changeId = null,
  allowedDirtyFiles = []
) {
  const head = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('verification-production:git-head-invalid');
  }
  const allowedDirty = new Set(
    allowedDirtyFiles.map((file) => normalizeRelative(file))
  );
  const dirtyImplementation = dirtyImplementationPaths(
    projectRoot,
    changeId
  ).filter((file) => !allowedDirty.has(normalizeRelative(file)));
  if (dirtyImplementation.length > 0) {
    const error = new Error('verification-production:dirty-worktree');
    error.blockers = [blocker(
      'verification-production:dirty-worktree',
      projectRoot,
      dirtyImplementation.slice(0, 20).join(',')
    )];
    throw error;
  }
  const repositoryInventory = git(projectRoot, [
    'ls-tree',
    '-r',
    'HEAD'
  ]);
  const testInventory = git(projectRoot, [
    'ls-tree',
    '-r',
    'HEAD',
    '--',
    'tests',
    'plugins/specnav-verification'
  ]);
  const testSha = crypto.createHash('sha256')
    .update(testInventory)
    .update(snapshot.snapshot_hash)
    .digest('hex');
  const environmentHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      runtime_version: runtimeStatus.runtime_version,
      runtime_root: runtimeStatus.runtime_root,
      runtime_authority_hash: runtimeAuthority?.digest || null,
      kernel_version: kernel.metadata.version
    }))
    .digest('hex');
  return {
    codeSha: kernel.codeInventorySha(repositoryInventory),
    testSha,
    environmentHash
  };
}

function pathsFor(projectRoot, changeId, args) {
  const changeRoot = path.join(
    projectRoot,
    'openspec',
    'changes',
    changeId
  );
  const verificationRoot = path.join(changeRoot, 'verify');
  const v2 = path.join(verificationRoot, 'v2');
  const values = {
    changeRoot,
    verificationRoot,
    snapshot: path.resolve(argValue(
      args,
      '--snapshot',
      path.join(v2, 'case-snapshot.json')
    )),
    approval: path.resolve(argValue(
      args,
      '--approval',
      path.join(v2, 'case-approval.json')
    )),
    requirements: path.resolve(argValue(
      args,
      '--requirements',
      path.join(v2, 'requirements-source.json')
    )),
    acceptance: path.resolve(argValue(
      args,
      '--acceptance',
      path.join(v2, 'acceptance-source.json')
    )),
    runtimeStatus: path.resolve(argValue(
      args,
      '--runtime-status',
      path.join(v2, 'runtime-status.json')
    ))
  };
  for (const [name, file] of Object.entries({
    snapshot: values.snapshot,
    approval: values.approval,
    requirements: values.requirements,
    acceptance: values.acceptance,
    runtimeStatus: values.runtimeStatus
  })) {
    const relative = path.relative(changeRoot, file);
    if (
      relative.startsWith('..')
      || path.isAbsolute(relative)
      || relative.split(path.sep).includes('..')
    ) {
      throw new Error(`verification-production:${name}-outside-change`);
    }
    let cursor = changeRoot;
    for (const segment of relative.split(path.sep)) {
      cursor = path.join(cursor, segment);
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`verification-production:${name}-path-symlink`);
      }
    }
  }
  return values;
}

function cleanChangeId(value) {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value === ''
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || value.includes('..')
    || /\s/.test(value)
  ) {
    return null;
  }
  return value;
}

function changeRegistry(projectRoot) {
  const changesRoot = path.join(projectRoot, 'openspec', 'changes');
  const ids = fs.existsSync(changesRoot)
    ? fs.readdirSync(changesRoot, { withFileTypes: true })
      .filter((entry) => (
        entry.isDirectory()
        && entry.name !== 'archive'
        && !entry.name.startsWith('.')
        && cleanChangeId(entry.name) === entry.name
      ))
      .map((entry) => entry.name)
      .sort()
    : [];
  let active = null;
  const activeFile = path.join(
    projectRoot,
    'openspec',
    '.specnav',
    'active-change'
  );
  if (fs.existsSync(activeFile)) {
    const value = fs.readFileSync(activeFile, 'utf8').replace(/\r?\n$/, '');
    if (value === value.trim()) active = cleanChangeId(value);
  } else {
    const registryFile = path.join(
      projectRoot,
      'openspec',
      '.specnav',
      'change-registry.json'
    );
    try {
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      active = cleanChangeId(
        registry?.current_focus || registry?.active_focus
      );
    } catch {
      active = null;
    }
  }
  return { active, ids };
}

function assertSelectedChange(projectRoot, changeId) {
  const selected = cleanChangeId(changeId);
  if (!selected) {
    throw new Error('verification-production:change-invalid');
  }
  const registry = changeRegistry(projectRoot);
  if (!registry.ids.includes(selected)) {
    throw new Error('verification-production:change-not-registered');
  }
  if (!registry.active) {
    throw new Error('verification-production:active-change-required');
  }
  if (registry.active !== selected) {
    throw new Error('verification-production:change-not-active');
  }
  return selected;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function loadScenarioRegistry(projectRoot, registryPath) {
  if (!registryPath) return null;
  if (path.isAbsolute(registryPath)) {
    throw new Error('verification-production:scenario-registry-absolute');
  }
  const project = fs.realpathSync(projectRoot);
  const requested = path.resolve(projectRoot, registryPath);
  const file = fs.realpathSync(requested);
  if (!isContained(project, file)) {
    throw new Error('verification-production:scenario-registry-outside-project');
  }
  let cursor = project;
  for (const segment of path.relative(project, file).split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error('verification-production:scenario-registry-symlink');
    }
  }
  if (!fs.lstatSync(file).isFile()) {
    throw new Error('verification-production:scenario-registry-not-file');
  }
  const relative = path.relative(project, file).split(path.sep).join('/');
  if (
    !relative.startsWith('tests/specnav/')
    || !/\.(?:c?js)$/.test(relative)
  ) {
    throw new Error('verification-production:scenario-registry-not-approved');
  }
  const tracked = spawnSync('git', ['show', `HEAD:${relative}`], {
    cwd: project,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024
  });
  if (
    tracked.status !== 0
    || !Buffer.isBuffer(tracked.stdout)
    || !tracked.stdout.equals(fs.readFileSync(file))
  ) {
    throw new Error('verification-production:scenario-registry-not-head-bound');
  }
  const loader = path.join(__dirname, 'scenario-registry-loader.js');
  const isolated = spawnSync(process.execPath, [
    '--permission',
    `--allow-fs-read=${file}`,
    `--allow-fs-read=${loader}`,
    loader,
    file
  ], {
    cwd: project,
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 8 * 1024 * 1024,
    env: {}
  });
  if (isolated.status !== 0) {
    throw new Error(
      isolated.error?.code === 'ETIMEDOUT'
        ? 'verification-production:scenario-registry-timeout'
        : 'verification-production:scenario-registry-isolation-failed'
    );
  }
  const revive = (value) => {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value).length === 1
      && typeof value.__specnav_function_source === 'string'
    ) {
      const source = value.__specnav_function_source;
      const compiled = new vm.Script(`(${source})`, {
        filename: 'approved-scenario-registry-function.js'
      }).runInNewContext({}, {
        timeout: 1000,
        contextCodeGeneration: {
          strings: false,
          wasm: false
        }
      });
      if (typeof compiled !== 'function') {
        throw new Error('verification-production:scenario-function-invalid');
      }
      return compiled;
    }
    if (Array.isArray(value)) return value.map(revive);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, revive(entry)])
      );
    }
    return value;
  };
  let scenarios;
  try {
    scenarios = revive(JSON.parse(isolated.stdout));
  } catch {
    throw new Error('verification-production:scenario-registry-invalid');
  }
  if (!scenarios || typeof scenarios !== 'object' || Array.isArray(scenarios)) {
    throw new Error('verification-production:scenario-registry-invalid');
  }
  return Object.freeze({
    file,
    resolve(id) {
      if (!Object.prototype.hasOwnProperty.call(scenarios, id)) {
        throw new Error(`scenario not found: ${id}`);
      }
      return scenarios[id];
    }
  });
}

function loadContext(args, dependencies = {}) {
  const projectRoot = path.resolve(argValue(args, '--project', process.cwd()));
  const changeId = argValue(args, '--change');
  const reviewerId = argValue(args, '--reviewer-id');
  if (!changeId) {
    return blocked(
      'verification-production:change-required',
      '--change'
    );
  }
  if (!reviewerId) {
    return blocked(
      'verification-production:reviewer-required',
      '--reviewer-id'
    );
  }
  try {
    const selectedChange = assertSelectedChange(projectRoot, changeId);
    const files = pathsFor(projectRoot, selectedChange, args);
    const context = {
      projectRoot,
      changeId: selectedChange,
      reviewerId,
      ...files,
      snapshotValue: readJson(
        files.snapshot,
        'verification-production:snapshot-read-failed'
      ),
      approvalValue: readJson(
        files.approval,
        'verification-production:approval-read-failed'
      ),
      requirementsValue: readJson(
        files.requirements,
        'verification-production:requirements-read-failed'
      ),
      acceptanceValue: readJson(
        files.acceptance,
        'verification-production:acceptance-read-failed'
      ),
      runtimeStatusValue: readJson(
        files.runtimeStatus,
        'verification-production:runtime-status-read-failed'
      )
    };
    const runtimeAuthority = dependencies.runtimeAuthority
      || kernel.createRuntimeAuthority({ projectRoot });
    const runtimeResolution = runtimeAuthority.resolve(
      context.runtimeStatusValue
    );
    if (!runtimeResolution.ok) {
      const error = new Error(
        'verification-production:runtime-authority-blocked'
      );
      error.blockers = runtimeResolution.blockers;
      throw error;
    }
    context.runtimeAuthority = runtimeResolution.authority;
    context.trustedFactKey = runtimeResolution.signingKey;
    context.runtimeStatusValue = runtimeResolution.runtimeStatus;
    const createSchemaRegistry = dependencies.createSchemaRegistry
      || kernel.createSchemaRegistry;
    context.schemaRegistry = createSchemaRegistry({
      runtimeStatus: context.runtimeStatusValue,
      runtimeRoot: runtimeResolution.runtimeRoot
    });
    return { ok: true, context, blockers: [] };
  } catch (error) {
    return {
      ok: false,
      status: 'blocked',
      blockers: Array.isArray(error.blockers)
        ? error.blockers
        : [blocker(
            error instanceof Error ? error.message : String(error),
            changeId
          )],
      fallback_used: false
    };
  }
}

async function run(args = process.argv.slice(2), dependencies = {}) {
  const action = args.find((entry) => !entry.startsWith('--')) || 'preflight';
  if (![
    'preflight',
    'generation-prepare',
    'generation-activate',
    'run',
    'finalize'
  ].includes(action)) {
    return blocked(
      `verification-production:unsupported-action:${action}`,
      action
    );
  }
  const loaded = loadContext(args, dependencies);
  if (!loaded.ok) return loaded;
  const context = loaded.context;
  const createApprovalValidator = dependencies.createCaseApprovalValidator
    || require('../kernel/cases').createCaseApprovalValidator;
  const approvalValidator = createApprovalValidator({
    schemaRegistry: context.schemaRegistry
  });
  const approvalState = approvalValidator.evaluate({
    snapshot: context.snapshotValue,
    approval: context.approvalValue,
    currentRequirements: context.requirementsValue,
    currentAcceptance: context.acceptanceValue,
    expectedReviewerId: context.reviewerId
  });
  if (!approvalState.ok) {
    return {
      ok: false,
      status: 'blocked',
      approval: approvalState,
      blockers: approvalState.blockers,
      fallback_used: false
    };
  }
  if (action === 'preflight') {
    return {
      ok: true,
      status: 'approved-current',
      snapshot_id: context.snapshotValue.id,
      snapshot_hash: context.snapshotValue.snapshot_hash,
      case_ids: context.snapshotValue.cases.map((entry) => entry.id),
      blockers: [],
      fallback_used: false
    };
  }
  let current;
  try {
    current = (dependencies.fingerprints || fingerprints)(
      context.projectRoot,
      context.snapshotValue,
      context.runtimeStatusValue,
      context.runtimeAuthority,
      context.changeId
    );
  } catch (error) {
    return {
      ok: false,
      status: 'blocked',
      blockers: Array.isArray(error.blockers)
        ? error.blockers
        : [blocker(
            error instanceof Error ? error.message : String(error),
            context.projectRoot
          )],
      fallback_used: false
    };
  }
  const providerSelection = loadProviderEnvironment({
    projectRoot: context.projectRoot,
    scope: context.runtimeStatusValue.runtime_scope,
    environment: process.env
  });
  if (!providerSelection.ok) {
    return {
      ok: false,
      status: 'blocked',
      blockers: providerSelection.blockers,
      fallback_used: false
    };
  }
  const clock = dependencies.clock || (() => new Date().toISOString());
  const secrets = stableSecrets(context.snapshotValue, {
    ...process.env,
    ...providerSelection.environment
  });
  const trustedFactAuthority = createTrustedFactAuthority({
    schemaRegistry: context.schemaRegistry,
    key: context.trustedFactKey,
    clock
  });
  const generationAuthority = (
    dependencies.createVerificationGenerationAuthority
    || kernel.createVerificationGenerationAuthority
  )({
    schemaRegistry: context.schemaRegistry,
    key: context.trustedFactKey,
    clock
  });
  const artifactStore = kernel.createVerificationArtifactStore({
    changeRoot: context.changeRoot,
    root: context.verificationRoot
  });
  const generationLogRead = artifactStore.readJsonl(
    'v2/generations.jsonl'
  );
  if (!generationLogRead.ok) {
    return {
      ok: false,
      status: 'blocked',
      blockers: generationLogRead.blockers,
      fallback_used: false
    };
  }
  const generationLog = generationAuthority.validateLog(
    generationLogRead.value,
    context.changeId
  );
  if (!generationLog.ok) {
    return {
      ok: false,
      status: 'blocked',
      blockers: generationLog.blockers,
      fallback_used: false
    };
  }
  const currentFingerprints = {
    case_snapshot_hash: context.snapshotValue.snapshot_hash,
    code_sha: current.codeSha,
    test_sha: current.testSha,
    environment_hash: current.environmentHash,
    runtime_version: context.runtimeStatusValue.runtime_version,
    kernel_version: kernel.metadata.version
  };
  const collected = kernel.collectGenerationState({
    store: artifactStore,
    changeId: context.changeId,
    reviewerId: context.reviewerId,
    snapshot: context.snapshotValue,
    currentFingerprints,
    parentGenerationId: generationLog.active?.id || null
  });
  if (!collected.ok) {
    return {
      ok: false,
      status: 'blocked',
      blockers: collected.blockers,
      fallback_used: false
    };
  }
  const generationState = structuredClone(collected.state);
  generationState.historical_break_loop_failure_ids = [
    ...new Set([
      ...(generationLog.active?.historical_break_loop_failure_ids || []),
      ...generationState.historical_break_loop_failure_ids
    ])
  ].sort();
  if (action === 'generation-prepare') {
    const prepared = generationAuthority.prepare(generationState);
    if (!prepared.ok) {
      return {
        ok: false,
        status: 'blocked',
        blockers: prepared.blockers,
        fallback_used: false
      };
    }
    const relativePath = `v2/generation-reviews/${prepared.review.id}.json`;
    const write = artifactStore.publishImmutableJson(
      relativePath,
      prepared.review
    );
    if (!write.ok) {
      const existing = artifactStore.readJson(relativePath);
      if (
        !existing.ok
        || canonicalJson(existing.value) !== canonicalJson(prepared.review)
      ) {
        return {
          ok: false,
          status: 'blocked',
          blockers: write.blockers,
          fallback_used: false
        };
      }
    }
    return {
      ok: true,
      status: 'approval-required',
      review: prepared.review,
      review_id: prepared.review.id,
      review_sha256: prepared.review.review_sha256,
      artifact: `verify/${relativePath}`,
      blockers: [],
      fallback_used: false
    };
  }
  if (action === 'generation-activate') {
    const reviewArg = argValue(args, '--generation-review');
    if (!reviewArg) {
      return blocked(
        'verification-generation:review-required',
        '--generation-review'
      );
    }
    const reviewPath = path.resolve(context.projectRoot, reviewArg);
    const reviewRoot = path.resolve(
      context.verificationRoot,
      'v2',
      'generation-reviews'
    );
    const relative = path.relative(reviewRoot, reviewPath);
    if (
      relative.startsWith('..')
      || path.isAbsolute(relative)
      || !relative.endsWith('.json')
    ) {
      return blocked(
        'verification-generation:review-path-invalid',
        reviewArg
      );
    }
    let review;
    try {
      review = readJson(
        reviewPath,
        'verification-generation:review-read-failed'
      );
    } catch (error) {
      return blocked(
        error instanceof Error ? error.message : String(error),
        reviewArg
      );
    }
    const appended = generationAuthority.append(
      artifactStore,
      review,
      generationState,
      args.includes('--approved')
    );
    if (!appended.ok) {
      return {
        ok: false,
        status: 'blocked',
        blockers: appended.blockers,
        fallback_used: false
      };
    }
    return {
      ok: true,
      status: 'activated',
      generation: appended.value,
      generation_id: appended.value.id,
      appended: appended.appended,
      artifact: 'verify/v2/generations.jsonl',
      blockers: [],
      fallback_used: false
    };
  }
  if (!generationLog.active) {
    return blocked(
      'verification-generation:active-required',
      'verify/v2/generations.jsonl'
    );
  }
  const activeGeneration = generationAuthority.validateActive(
    generationLog.active,
    generationState
  );
  if (!activeGeneration.ok) {
    return {
      ok: false,
      status: 'blocked',
      blockers: activeGeneration.blockers,
      fallback_used: false
    };
  }
  const createArtifactPipeline = dependencies.createVerificationArtifactPipeline
    || kernel.createVerificationArtifactPipeline;
  if (action === 'finalize') {
    return createArtifactPipeline({
      kernel,
      schemaRegistry: context.schemaRegistry,
      changeRoot: context.changeRoot,
      verificationRoot: context.verificationRoot,
      snapshot: context.snapshotValue,
      approval: context.approvalValue,
      currentFingerprints,
      activeGeneration: activeGeneration.generation,
      trustedFactAuthority,
      clock,
      secrets
    }).build();
  }
  let scenarioRegistry = null;
  try {
    scenarioRegistry = (dependencies.loadScenarioRegistry
      || loadScenarioRegistry)(
      context.projectRoot,
      argValue(args, '--scenario-registry')
    );
  } catch (error) {
    return blocked(
      error instanceof Error ? error.message : String(error),
      '--scenario-registry'
    );
  }
  const createProductionRunner = dependencies.createProductionVerificationRunner
    || kernel.createProductionVerificationRunner;
  const runner = createProductionRunner({
    kernel,
    schemaRegistry: context.schemaRegistry,
    projectRoot: context.projectRoot,
    changeRoot: context.changeRoot,
    verificationRoot: context.verificationRoot,
    runtimeStatus: context.runtimeStatusValue,
    snapshot: context.snapshotValue,
    approval: context.approvalValue,
    requirements: context.requirementsValue,
    acceptance: context.acceptanceValue,
    reviewerId: context.reviewerId,
    codeSha: current.codeSha,
    testSha: current.testSha,
    environmentHash: current.environmentHash,
    generation: activeGeneration.generation,
    clock,
    secrets,
    providerEnvironment: providerSelection.environment,
    scenarioRegistry,
    repairIdentityResolver(failureId) {
      return resolveRepairIdentity(context, trustedFactAuthority, failureId);
    }
  });
  if (!runner.approvalState.ok) {
    return {
      ok: false,
      status: 'blocked',
      blockers: runner.approvalState.blockers,
      fallback_used: false
    };
  }
  const selectedCase = argValue(args, '--case');
  const attemptKind = argValue(args, '--attempt-kind', 'initial');
  const parentAttemptId = argValue(args, '--parent-attempt');
  const failureId = argValue(args, '--failure-id');
  if (attemptKind !== 'initial' && !selectedCase) {
    return blocked(
      'verification-production:followup-case-required',
      '--case',
      attemptKind
    );
  }
  const caseIds = selectedCase
    ? [selectedCase]
    : context.snapshotValue.cases.map((entry) => entry.id);
  const results = [];
  for (const caseId of caseIds) {
    results.push(await runner.executeCase(caseId, {
      kind: attemptKind,
      parentAttemptId,
      failureId
    }));
  }
  if (selectedCase) {
    return {
      ...results[0],
      fallback_used: false
    };
  }
  if (results.some((entry) => entry.ok !== true)) {
    return {
      ok: false,
      status: 'blocked',
      cases: results,
      blockers: results.flatMap((entry) => entry.blockers || []),
      fallback_used: false
    };
  }
  const finalized = createArtifactPipeline({
    kernel,
    schemaRegistry: context.schemaRegistry,
    changeRoot: context.changeRoot,
    verificationRoot: context.verificationRoot,
    snapshot: context.snapshotValue,
    approval: context.approvalValue,
    currentFingerprints,
    activeGeneration: activeGeneration.generation,
    trustedFactAuthority,
    clock,
    secrets
  }).build();
  return {
    ...finalized,
    cases: results,
    fallback_used: false
  };
}

function stableSecrets(snapshot, environment = process.env) {
  const values = new Set();
  for (const testCase of snapshot.cases || []) {
    for (const key of testCase.runner?.env_keys || []) {
      if (
        key.startsWith('SPECNAV_')
        || typeof environment[key] !== 'string'
        || environment[key].length === 0
      ) {
        continue;
      }
      values.add(environment[key]);
    }
  }
  return [...values];
}

function executionArtifactList(result) {
  const runId = result?.run?.id;
  const attemptId = result?.attempt?.id;
  if (!runId || !attemptId) return [];
  const base = `verify/runs/${runId}`;
  const attemptBase = `${base}/attempts/${attemptId}`;
  return [
    { name: 'run', path: `${base}/run.json`, ok: true },
    { name: 'run-integrity', path: `${base}/integrity.json`, ok: true },
    { name: 'attempt', path: `${attemptBase}/attempt.json`, ok: true },
    { name: 'attempt-integrity', path: `${attemptBase}/integrity.json`, ok: true },
    { name: 'execution', path: `${attemptBase}/execution.json`, ok: true },
    {
      name: 'assertion-results',
      path: `${attemptBase}/assertion-results.jsonl`,
      ok: true
    }
  ];
}

function summarizeCaseExecution(result = {}) {
  const blockers = Array.isArray(result.blockers)
    ? structuredClone(result.blockers)
    : [];
  const runId = result?.run?.id || null;
  const attemptId = result?.attempt?.id || null;
  return {
    ok: result.ok === true,
    status: typeof result.status === 'string' ? result.status : 'blocked',
    case_id: result?.attempt?.case_id
      || (Array.isArray(result?.run?.case_ids) ? result.run.case_ids[0] : null),
    run_id: runId,
    attempt_id: attemptId,
    evidence_count: Array.isArray(result.evidence) ? result.evidence.length : 0,
    reading_count: Array.isArray(result.readings) ? result.readings.length : 0,
    failure_id: result?.failure_packet?.id || null,
    repair_handoff: result?.repair_handoff
      ? structuredClone(result.repair_handoff)
      : null,
    blockers,
    artifacts: executionArtifactList(result),
    fallback_used: false
  };
}

function finalizedArtifactList(result) {
  const artifacts = [
    { name: 'runs', path: 'verify/v2/runs.json', ok: true },
    { name: 'attempts', path: 'verify/v2/attempts.json', ok: true },
    { name: 'readings', path: 'verify/v2/readings.json', ok: true },
    { name: 'executions', path: 'verify/v2/executions.json', ok: true },
    { name: 'failures', path: 'verify/v2/failures.json', ok: true }
  ];
  if (result.release_gate) {
    artifacts.push({
      name: 'release-gate',
      path: 'verify/v2/release-gate.json',
      ok: true
    });
  }
  if (result.archive_gate) {
    artifacts.push({
      name: 'archive-gate',
      path: 'verify/v2/archive-gate.json',
      ok: true
    });
  }
  if (result.report_model) {
    artifacts.push({
      name: 'report-model',
      path: 'verify/v2/report-model.json',
      ok: true
    });
  }
  if (result.report_manifest) {
    artifacts.push({
      name: 'report-render-manifest',
      path: 'verify/v2/report-render-manifest.json',
      ok: true
    });
    for (const report of result.report_manifest.reports || []) {
      if (report && typeof report.path === 'string') {
        artifacts.push({
          name: report.name || path.basename(report.path),
          path: report.path,
          ok: true
        });
      }
    }
  }
  return artifacts;
}

function summarizeCliResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }
  if (result.run && result.attempt && !Array.isArray(result.cases)) {
    return summarizeCaseExecution(result);
  }
  const finalized = result.aggregate
    || result.release_gate
    || result.archive_gate
    || result.report_model
    || result.report_manifest;
  if (!Array.isArray(result.cases) && !finalized) return result;
  const cases = Array.isArray(result.cases)
    ? result.cases.map(summarizeCaseExecution)
    : [];
  const artifacts = [
    ...cases.flatMap((entry) => entry.artifacts),
    ...finalizedArtifactList(result)
  ];
  return {
    ok: result.ok === true,
    status: typeof result.status === 'string' ? result.status : 'blocked',
    aggregate_status: result?.aggregate?.status || null,
    release_gate_id: result?.release_gate?.id || null,
    archive_gate_id: result?.archive_gate?.id || null,
    report_model_id: result?.report_model?.id || null,
    cases,
    blockers: Array.isArray(result.blockers)
      ? structuredClone(result.blockers)
      : [],
    artifacts,
    fallback_used: false
  };
}

function writeCliJson(value) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  return new Promise((resolve, reject) => {
    process.stdout.write(output, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const result = await run();
  await writeCliJson(summarizeCliResult(result));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) {
  main().catch(async (error) => {
    await writeCliJson(blocked(
      'verification-production:unhandled',
      'verification-v2-run',
      error instanceof Error ? error.message : String(error)
    ));
    process.exitCode = 2;
  });
}

module.exports = {
  assertSelectedChange,
  dirtyImplementationPaths,
  fingerprints,
  resolveRepairIdentity,
  isLifecyclePath,
  loadContext,
  loadScenarioRegistry,
  pathsFor,
  run,
  stableSecrets,
  summarizeCaseExecution,
  summarizeCliResult,
  writeCliJson
};
