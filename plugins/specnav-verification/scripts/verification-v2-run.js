#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const kernel = require('../kernel');

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

function fingerprints(projectRoot, snapshot, runtimeStatus, runtimeAuthority = null) {
  const head = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('verification-production:git-head-invalid');
  }
  const status = git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim() !== '') {
    const error = new Error('verification-production:dirty-worktree');
    error.blockers = [blocker(
      'verification-production:dirty-worktree',
      projectRoot,
      status.trim().split(/\r?\n/).slice(0, 20).join(',')
    )];
    throw error;
  }
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
    codeSha: head,
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
      || kernel.createRuntimeAuthority();
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
  if (!['preflight', 'run', 'finalize'].includes(action)) {
    return blocked(
      `verification-production:unsupported-action:${action}`,
      action
    );
  }
  const loaded = loadContext(args, dependencies);
  if (!loaded.ok) return loaded;
  const context = loaded.context;
  const approvalValidator = require('../kernel/cases')
    .createCaseApprovalValidator({
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
      context.runtimeAuthority
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
  const clock = dependencies.clock || (() => new Date().toISOString());
  const secrets = stableSecrets(context.snapshotValue);
  if (action === 'finalize') {
    return kernel.createVerificationArtifactPipeline({
      kernel,
      schemaRegistry: context.schemaRegistry,
      changeRoot: context.changeRoot,
      verificationRoot: context.verificationRoot,
      snapshot: context.snapshotValue,
      approval: context.approvalValue,
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
  const runner = kernel.createProductionVerificationRunner({
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
    clock,
    secrets,
    scenarioRegistry
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
  const finalized = kernel.createVerificationArtifactPipeline({
    kernel,
    schemaRegistry: context.schemaRegistry,
    changeRoot: context.changeRoot,
    verificationRoot: context.verificationRoot,
    snapshot: context.snapshotValue,
    approval: context.approvalValue,
    clock,
    secrets
  }).build();
  return {
    ...finalized,
    cases: results,
    fallback_used: false
  };
}

function stableSecrets(snapshot) {
  const values = new Set();
  for (const testCase of snapshot.cases || []) {
    for (const key of testCase.runner?.env_keys || []) {
      if (
        key.startsWith('SPECNAV_')
        || typeof process.env[key] !== 'string'
        || process.env[key].length === 0
      ) {
        continue;
      }
      values.add(process.env[key]);
    }
  }
  return [...values];
}

async function main() {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify(blocked(
      'verification-production:unhandled',
      'verification-v2-run',
      error instanceof Error ? error.message : String(error)
    ), null, 2)}\n`);
    process.exit(2);
  });
}

module.exports = {
  assertSelectedChange,
  fingerprints,
  loadContext,
  loadScenarioRegistry,
  pathsFor,
  run,
  stableSecrets
};
