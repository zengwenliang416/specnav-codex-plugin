#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

function fingerprints(projectRoot, snapshot, runtimeStatus) {
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
  return {
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
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function loadScenarioRegistry(projectRoot, registryPath) {
  if (!registryPath) return null;
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
  const loaded = require(file);
  const scenarios = loaded?.scenarios || loaded;
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
    const files = pathsFor(projectRoot, changeId, args);
    const context = {
      projectRoot,
      changeId,
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
    const createSchemaRegistry = dependencies.createSchemaRegistry
      || kernel.createSchemaRegistry;
    context.schemaRegistry = createSchemaRegistry({
      runtimeStatus: context.runtimeStatusValue,
      runtimeRoot: context.runtimeStatusValue.runtime_root
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
      context.runtimeStatusValue
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
  fingerprints,
  loadContext,
  loadScenarioRegistry,
  pathsFor,
  run,
  stableSecrets
};
