#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const kernel = require('../kernel');
const {
  createAuthorityLog
} = require('../kernel/repair/authority-log');
const {
  createTrustedFactAuthority
} = require('../kernel/repair/trusted-fact-authority');
const {
  canonicalJson,
  sha256
} = require('../kernel/evidence/identity');
const {
  computeRerunScope
} = require('./rerun-scope');
const {
  fingerprints,
  loadContext
} = require('./verification-v2-run');

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

function resolveChangeFile(context, value, id) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(id);
  }
  const requested = path.resolve(context.projectRoot, value);
  const relative = path.relative(context.changeRoot, requested);
  if (
    relative.startsWith('..')
    || path.isAbsolute(relative)
    || relative.split(path.sep).includes('..')
  ) {
    throw new Error(`${id}:outside-change`);
  }
  return relative.split(path.sep).join('/');
}

function paths(context, failureId = null) {
  const repairRoot = failureId
    ? path.posix.join('repairs', failureId)
    : null;
  return {
    repairRoot,
    repairRecoveries: repairRoot
      ? path.posix.join(repairRoot, 'repair-lineage-recoveries.jsonl')
      : null,
    repairRebinds: repairRoot
      ? path.posix.join(repairRoot, 'repair-generation-rebinds.jsonl')
      : null,
    historicalArtifactLosses: repairRoot
      ? path.posix.join(repairRoot, 'historical-artifact-losses.jsonl')
      : null,
    rerunPlans: repairRoot
      ? path.posix.join(repairRoot, 'rerun-plans.jsonl')
      : null,
    failures: 'v2/failures.json',
    runs: 'v2/runs.json',
    attempts: 'v2/attempts.json',
    readings: 'v2/readings.json',
    repairLinks: 'v2/repair-links.json',
    transitionProposals: 'v2/transition-proposals.jsonl',
    transitionReceipts: 'v2/transition-receipts.jsonl',
    attemptFacts: 'v2/attempt-facts.jsonl',
    failureState: 'v2/failure-state.json',
    evidenceIndex: 'evidence/index.json'
  };
}

function globPattern(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += /[\\^$.*+?()[\]{}|]/.test(character)
        ? `\\${character}`
        : character;
    }
  }
  return new RegExp(`${source}$`);
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => globPattern(pattern).test(file));
}

function lifecycleRepairPath(changeId, failureId, taskId, file) {
  return file.startsWith(
    `openspec/changes/${changeId}/verify/repairs/${failureId}/`
  )
    || file.startsWith(
      `openspec/changes/${changeId}/development/tasks/${taskId}/`
    )
    || file === (
      `openspec/changes/${changeId}/verify/v2/repair-links.json`
    );
}

function gitDiff(projectRoot, before, after) {
  const result = spawnSync('git', [
    'diff',
    '--name-status',
    '--no-renames',
    before,
    after
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'git diff failed');
  }
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split('\t');
      return { status, file: parts.at(-1) };
    });
}

function gitOutput(projectRoot, args) {
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

function repairCompletionFingerprints(
  projectRoot,
  snapshot,
  runtimeStatus,
  runtimeAuthority,
  allowedDirtyFiles
) {
  const allowed = new Set(allowedDirtyFiles);
  const status = gitOutput(projectRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ]);
  const dirty = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3));
  const outsideReview = dirty.filter((file) => (
    file.includes(' -> ') || !allowed.has(file)
  ));
  if (outsideReview.length > 0) {
    const error = new Error('verification-production:dirty-worktree');
    error.blockers = [blocker(
      'verification-production:dirty-worktree',
      projectRoot,
      outsideReview.slice(0, 20).join(',')
    )];
    throw error;
  }
  const head = gitOutput(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('verification-production:git-head-invalid');
  }
  const repositoryInventory = gitOutput(projectRoot, [
    'ls-tree',
    '-r',
    'HEAD'
  ]);
  const testInventory = gitOutput(projectRoot, [
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
    environmentHash,
    gitRevision: head
  };
}

function validateRepairDiff({
  projectRoot,
  changeId,
  failureId,
  task,
  beforeIdentity,
  afterIdentity,
  beforeRevision = beforeIdentity?.code_sha,
  afterRevision = afterIdentity?.code_sha
}) {
  if (
    !task
    || typeof task !== 'object'
    || !task.scope
    || !Array.isArray(task.scope.allowed_files)
    || !Array.isArray(task.scope.denied_files)
    || !task.scope.allowed_operations
    || !/^[a-f0-9]{40}$/.test(beforeRevision || '')
    || !/^[a-f0-9]{40}$/.test(afterRevision || '')
  ) {
    return blocked(
      'verification-repair:scope-diff-input-invalid',
      task?.id || 'repair-task'
    );
  }
  let changes;
  try {
    changes = gitDiff(
      projectRoot,
      beforeRevision,
      afterRevision
    );
  } catch (error) {
    return blocked(
      'verification-repair:scope-diff-failed',
      task.id,
      error instanceof Error ? error.message : String(error)
    );
  }
  const sourceChanges = changes.filter((change) => !lifecycleRepairPath(
    changeId,
    failureId,
    task.id,
    change.file
  ));
  if (sourceChanges.length === 0) {
    return blocked(
      'verification-repair:scope-diff-empty',
      task.id
    );
  }
  for (const change of sourceChanges) {
    const operation = change.status === 'A'
      ? 'create'
      : change.status === 'M'
        ? 'modify'
        : change.status === 'D'
          ? 'delete'
          : 'rename';
    if (
      !change.file
      || !matchesAny(change.file, task.scope.allowed_files)
      || matchesAny(change.file, task.scope.denied_files)
      || task.scope.allowed_operations[operation] !== true
    ) {
      return blocked(
        'verification-repair:scope-diff-outside-lock',
        change.file || task.id,
        change.status
      );
    }
  }
  return {
    ok: true,
    status: 'scope_verified',
    changes: sourceChanges,
    blockers: [],
    fallback_used: false
  };
}

function validateRepairRebindScope({
  projectRoot,
  task,
  afterRevision,
  reviewedFiles
}) {
  if (
    !task?.scope
    || !Array.isArray(task.scope.allowed_files)
    || !Array.isArray(task.scope.denied_files)
    || !Array.isArray(task.scope.requires_review_on)
    || !/^[a-f0-9]{40}$/.test(afterRevision || '')
    || !Array.isArray(reviewedFiles)
    || reviewedFiles.length === 0
  ) {
    return blocked(
      'verification-repair:rebind-scope-input-invalid',
      task?.id || 'repair-task'
    );
  }
  const head = currentGitRevision(projectRoot);
  if (head !== afterRevision) {
    return blocked(
      'verification-repair:rebind-head-mismatch',
      task.id,
      `${afterRevision}:${head}`
    );
  }
  const changes = [];
  const seen = new Set();
  for (const entry of reviewedFiles) {
    if (
      !entry
      || typeof entry.file !== 'string'
      || !/^[a-f0-9]{40}$/.test(entry.blob_sha || '')
      || seen.has(entry.file)
      || !matchesAny(entry.file, task.scope.allowed_files)
      || !matchesAny(entry.file, task.scope.requires_review_on)
      || matchesAny(entry.file, task.scope.denied_files)
    ) {
      return blocked(
        'verification-repair:rebind-reviewed-file-invalid',
        entry?.file || task.id
      );
    }
    let actual;
    try {
      actual = gitOutput(
        projectRoot,
        ['rev-parse', `${afterRevision}:${entry.file}`]
      ).trim();
    } catch (error) {
      return blocked(
        'verification-repair:rebind-reviewed-file-missing',
        entry.file,
        error instanceof Error ? error.message : String(error)
      );
    }
    if (actual !== entry.blob_sha) {
      return blocked(
        'verification-repair:rebind-reviewed-file-mismatch',
        entry.file,
        `${entry.blob_sha}:${actual}`
      );
    }
    seen.add(entry.file);
    changes.push({ status: 'M', file: entry.file });
  }
  return {
    ok: true,
    status: 'scope_verified',
    changes: changes.sort((left, right) => left.file.localeCompare(right.file)),
    blockers: [],
    fallback_used: false
  };
}

function mergeById(values, additions) {
  const byId = new Map(values.map((value) => [value.id, value]));
  for (const value of additions) byId.set(value.id, value);
  return [...byId.values()].sort((left, right) => (
    left.id.localeCompare(right.id)
  ));
}

function writeJson(store, relative, value) {
  const result = store.publishJson(relative, value);
  if (!result.ok) {
    const error = new Error('verification-repair:persistence-failed');
    error.blockers = result.blockers;
    throw error;
  }
  return result;
}

function writeText(store, relative, value) {
  const result = store.publishText(relative, value);
  if (!result.ok) {
    const error = new Error('verification-repair:persistence-failed');
    error.blockers = result.blockers;
    throw error;
  }
  return result;
}

function readRequiredJson(store, relative, id) {
  const result = store.readJson(relative);
  if (!result.ok) {
    const error = new Error(id);
    error.blockers = result.blockers.map((entry) => ({
      ...entry,
      id
    }));
    throw error;
  }
  return result.value;
}

function readOptionalJson(store, relative, fallback = null) {
  const bytes = store.readBytes(relative);
  if (!bytes.ok) {
    const error = new Error('verification-repair:artifact-read-failed');
    error.blockers = bytes.blockers;
    throw error;
  }
  if (bytes.missing) return structuredClone(fallback);
  try {
    return JSON.parse(bytes.bytes.toString('utf8'));
  } catch (error) {
    const failure = new Error('verification-repair:artifact-json-invalid');
    failure.blockers = [blocker(
      'verification-repair:artifact-json-invalid',
      relative,
      error instanceof Error ? error.message : String(error)
    )];
    throw failure;
  }
}

function readRequiredJsonl(store, relative, id) {
  const result = store.readJsonl(relative);
  if (!result.ok) {
    const error = new Error(id);
    error.blockers = result.blockers.map((entry) => ({
      ...entry,
      id
    }));
    throw error;
  }
  return result.value;
}

function persistTrustedEnvelope(
  store,
  relative,
  envelope,
  authority
) {
  const existing = readOptionalJson(store, relative);
  if (existing) {
    if (
      !authority.verify(existing).ok
      || existing.kind !== envelope.kind
      || canonicalJson(existing.payload) !== canonicalJson(envelope.payload)
      || canonicalJson(existing.bindings) !== canonicalJson(envelope.bindings)
      || canonicalJson(existing.claims) !== canonicalJson(envelope.claims)
      || existing.producer !== envelope.producer
    ) {
      throw new Error('verification-repair:trusted-envelope-conflict');
    }
    return { envelope: existing, persisted: false };
  }
  const result = store.publishImmutableJson(relative, envelope);
  if (!result.ok) {
    const error = new Error('verification-repair:persistence-failed');
    error.blockers = result.blockers;
    throw error;
  }
  return { envelope, persisted: true };
}

function appendTrustedEnvelopeHistory({
  authorityLog,
  authority,
  relative,
  kind,
  payload,
  expectedBindings,
  legacyEnvelope = null
}) {
  let history = authorityLog.validate(relative, kind);
  if (!history.ok) {
    const error = new Error(
      'verification-repair:trusted-history-invalid'
    );
    error.blockers = history.blockers;
    throw error;
  }
  if (history.value.length === 0 && legacyEnvelope) {
    const verification = authority.verify(legacyEnvelope);
    const legacyBindings = legacyEnvelope.bindings || {};
    if (
      !verification.ok
      || legacyEnvelope.kind !== kind
      || Object.entries(expectedBindings).some(([field, value]) => (
        legacyBindings[field] !== value
      ))
      || Object.hasOwn(legacyBindings, 'log_sequence')
      || Object.hasOwn(legacyBindings, 'previous_envelope_digest')
    ) {
      throw new Error(
        'verification-repair:legacy-trusted-envelope-invalid'
      );
    }
    const migrated = authorityLog.append(
      relative,
      kind,
      legacyEnvelope.payload,
      expectedBindings
    );
    if (!migrated.ok) {
      const error = new Error(
        'verification-repair:trusted-history-migration-failed'
      );
      error.blockers = migrated.blockers;
      throw error;
    }
    history = migrated;
  }
  const appended = authorityLog.append(
    relative,
    kind,
    payload,
    expectedBindings
  );
  if (!appended.ok) {
    const error = new Error(
      'verification-repair:trusted-history-append-failed'
    );
    error.blockers = appended.blockers;
    throw error;
  }
  return appended;
}

function rootFailure(context, failureId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(failureId)) {
    throw new Error('verification-repair:failure-id-invalid');
  }
  const store = kernel.createVerificationArtifactStore({
    changeRoot: context.changeRoot,
    root: context.verificationRoot
  });
  const files = paths(context, failureId);
  const failures = readRequiredJson(
    store,
    files.failures,
    'verification-repair:failures-read-failed'
  );
  const matches = failures.filter((failure) => failure.id === failureId);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? 'verification-repair:failure-missing'
        : 'verification-repair:failure-ambiguous'
    );
  }
  const failure = matches[0];
  const runs = readRequiredJson(
    store,
    files.runs,
    'verification-repair:runs-read-failed'
  );
  const run = runs.find((entry) => entry.id === failure.run_id);
  if (
    !run
    || failure.change_id !== context.changeId
    || run.change_id !== context.changeId
    || run.kind !== 'initial'
    || run.failure_id !== null
    || run.origin_run_id !== null
    || run.parent_run_id !== null
    || !run.case_ids.includes(failure.case_id)
  ) {
    throw new Error('verification-repair:not-root-failure');
  }
  const rawFailures = readRequiredJsonl(
    store,
    path.posix.join('runs', run.id, 'failures.jsonl'),
    'verification-repair:raw-failures-read-failed'
  );
  const rawMatches = rawFailures.filter((entry) => entry.id === failure.id);
  if (
    rawMatches.length !== 1
    || canonicalJson(rawMatches[0]) !== canonicalJson(failure)
  ) {
    throw new Error('verification-repair:root-projection-invalid');
  }
  return {
    failure,
    failures,
    rawFailures: [...new Set(
      failures.map((entry) => entry.run_id)
    )].flatMap((runId) => readRequiredJsonl(
      store,
      path.posix.join('runs', runId, 'failures.jsonl'),
      'verification-repair:raw-failures-read-failed'
    )),
    runs,
    files,
    store
  };
}

function evidenceFor(context, store, ids) {
  const index = readRequiredJson(
    store,
    paths(context).evidenceIndex,
    'verification-repair:evidence-index-read-failed'
  );
  const byId = new Map((index.entries || []).map((entry) => [
    entry.id,
    entry
  ]));
  const values = ids.map((id) => byId.get(id)).filter(Boolean);
  if (values.length !== ids.length) {
    throw new Error('verification-repair:evidence-missing');
  }
  return values;
}

function initialAttempt(context, store, failure) {
  const attempts = readRequiredJson(
    store,
    paths(context).attempts,
    'verification-repair:attempts-read-failed'
  );
  const matches = attempts.filter((attempt) => (
    attempt.id === failure.attempt_id
  ));
  if (matches.length !== 1) {
    throw new Error('verification-repair:initial-attempt-missing');
  }
  return matches[0];
}

function attemptFingerprint(attempt) {
  return {
    case_snapshot_hash: attempt.case_snapshot_hash,
    code_sha: attempt.code_sha,
    test_sha: attempt.test_sha,
    environment_hash: attempt.environment_hash,
    runtime_version: attempt.runtime_version,
    kernel_version: attempt.kernel_version
  };
}

const FINGERPRINT_FIELDS = Object.freeze([
  'case_snapshot_hash',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]);

const REPAIR_LINEAGE_FIELDS = Object.freeze([
  'schema',
  'id',
  'failure_id',
  'change_id',
  'development_task_id',
  'repair_kind',
  'requested_at',
  'scope_digest'
]);

function currentFingerprint(context, value) {
  return {
    case_snapshot_hash: context.snapshotValue.snapshot_hash,
    code_sha: value.codeSha,
    test_sha: value.testSha,
    environment_hash: value.environmentHash,
    runtime_version: context.runtimeStatusValue.runtime_version,
    kernel_version: kernel.metadata.version
  };
}

function currentGitRevision(projectRoot) {
  const revision = gitOutput(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('verification-repair:git-revision-invalid');
  }
  return revision;
}

function fingerprintDrift(expected, actual) {
  return FINGERPRINT_FIELDS.filter((field) => (
    expected?.[field] !== actual?.[field]
  ));
}

function envelopeDigest(envelope) {
  return sha256(canonicalJson(envelope));
}

function repairBaseline(
  context,
  authority,
  failure,
  link,
  gitRevision,
  clock
) {
  const payload = {
    schema: 'specnav.verification.repair-baseline.v1',
    id: `repair-baseline-${sha256(canonicalJson({
      failure_id: link.failure_id,
      repair_link_id: link.id,
      before_identity: link.before_identity,
      git_revision: gitRevision
    }))}`,
    failure_id: link.failure_id,
    change_id: link.change_id,
    repair_link_id: link.id,
    repair_link_digest: sha256(canonicalJson(link)),
    before_identity: link.before_identity,
    git_revision: gitRevision,
    recorded_at: clock()
  };
  const validated = context.schemaRegistry.validate(
    'repair-baseline',
    payload
  );
  if (!validated.ok) {
    throw new Error('verification-repair:repair-baseline-invalid');
  }
  return authority.seal(
    'repair_baseline',
    validated.value,
    bindings(failure)
  );
}

function repairLineageDrift(requested, candidate) {
  const fields = REPAIR_LINEAGE_FIELDS.filter((field) => (
    requested?.[field] !== candidate?.[field]
  ));
  if (fingerprintDrift(
    requested?.before_identity,
    candidate?.before_identity
  ).length > 0) {
    fields.push('before_identity');
  }
  return fields;
}

function integrityForAttempt(context, store, attempt) {
  return readRequiredJson(store, path.posix.join(
    'runs',
    attempt.run_id,
    'attempts',
    attempt.id,
    'integrity.json'
  ), 'verification-repair:attempt-integrity-read-failed');
}

function classifierIntegrity(context, store, failure) {
  const attempt = initialAttempt(context, store, failure);
  const integrity = integrityForAttempt(context, store, attempt);
  const required = new Set(failure.evidence_ids);
  const facts = (integrity.facts?.evidence || []).filter((entry) => (
    required.has(entry.evidence_id)
  ));
  return {
    ok: integrity.ok === true && facts.length === required.size,
    facts: {
      summary: {
        evidence_count: facts.length,
        integrity: facts.every((entry) => entry.integrity === 'intact')
          ? 'intact'
          : 'broken',
        freshness: facts.every((entry) => entry.freshness === 'fresh')
          ? 'fresh'
          : 'stale'
      },
      evidence: facts
    },
    blockers: facts.length === required.size
      ? []
      : [blocker(
          'verification-repair:evidence-integrity-incomplete',
          failure.id
        )]
  };
}

function trustAuthority(context, clock) {
  return createTrustedFactAuthority({
    schemaRegistry: context.schemaRegistry,
    key: context.trustedFactKey,
    clock
  });
}

function bindings(failure, attemptId = null) {
  return {
    failure_id: failure.id,
    change_id: failure.change_id,
    run_id: failure.run_id,
    case_id: failure.case_id,
    ...(attemptId ? { attempt_id: attemptId } : {})
  };
}

function relativeRepairPath(failureId, name) {
  return path.posix.join('repairs', failureId, name);
}

function loadEnvelope(context, store, failureId, name) {
  return readRequiredJson(
    store,
    path.posix.join(paths(context, failureId).repairRoot, name),
    `verification-repair:${name}-read-failed`
  );
}

function classificationEnvelope(context, store, failureId) {
  return loadEnvelope(
    context,
    store,
    failureId,
    'classification-envelope.json'
  );
}

function classificationEnvelopeInventory(context, root) {
  const inventory = root.store.listDirectory('repairs');
  if (!inventory.ok) {
    const error = new Error(
      'verification-repair:classification-inventory-read-failed'
    );
    error.blockers = inventory.blockers;
    throw error;
  }
  const envelopes = [];
  for (const entry of inventory.entries) {
    if (
      entry.type !== 'directory'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.name)
    ) {
      const error = new Error(
        'verification-repair:classification-inventory-invalid'
      );
      error.blockers = [blocker(
        'verification-repair:classification-inventory-invalid',
        path.posix.join('repairs', entry.name),
        entry.type
      )];
      throw error;
    }
    const envelope = readOptionalJson(
      root.store,
      path.posix.join(
        paths(context, entry.name).repairRoot,
        'classification-envelope.json'
      )
    );
    if (envelope) envelopes.push(envelope);
  }
  return envelopes;
}

function envelopesForFailure(envelopes, failureId) {
  return envelopes.filter((envelope) => (
    envelope?.bindings?.failure_id === failureId
    && envelope?.payload?.failure_id === failureId
  ));
}

function repairEnvelope(context, store, failureId) {
  const completed = readOptionalJson(
    store,
    path.posix.join(
      paths(context, failureId).repairRoot,
      'repair-link-completed-envelope.json'
    )
  );
  const started = readOptionalJson(
    store,
    path.posix.join(
      paths(context, failureId).repairRoot,
      'repair-link-started-envelope.json'
    )
  );
  return completed || started || loadEnvelope(
    context,
    store,
    failureId,
    'repair-link-requested-envelope.json'
  );
}

function historyFor(context, store, failure) {
  const files = paths(context);
  const runs = readRequiredJson(
    store,
    files.runs,
    'verification-repair:runs-read-failed'
  );
  const selectedRuns = runs.filter((run) => (
    run.id === failure.run_id || run.failure_id === failure.id
  ));
  const runIds = new Set(selectedRuns.map((run) => run.id));
  const attempts = readRequiredJson(
    store,
    files.attempts,
    'verification-repair:attempts-read-failed'
  ).filter((attempt) => runIds.has(attempt.run_id));
  return { runs: selectedRuns, attempts };
}

function historicalArtifactPathAllowed(failure, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath !== path.posix.normalize(relativePath)
    || relativePath.startsWith('/')
    || relativePath.includes('\\')
  ) {
    return false;
  }
  return relativePath.startsWith(`runs/${failure.run_id}/`);
}

function attemptFact(context, store, attempt) {
  const integrity = integrityForAttempt(context, store, attempt);
  const facts = integrity.facts?.evidence || [];
  return {
    attempt_id: attempt.id,
    case_id: attempt.case_id,
    attempt_digest: sha256(canonicalJson(attempt)),
    verdict: attempt.status === 'passed'
      ? 'pass'
      : attempt.status === 'blocked'
        ? 'blocked'
        : 'fail',
    evidence_ids: [...new Set(
      facts.map((entry) => entry.evidence_id)
    )].sort(),
    integrity: integrity.ok === true
      && facts.every((entry) => entry.integrity === 'intact')
      ? 'intact'
      : 'invalid',
    freshness: facts.length > 0
      && facts.every((entry) => entry.freshness === 'fresh')
      ? 'fresh'
      : 'stale',
    recorded_at: attempt.completed_at
  };
}

function scopeProjection(plan) {
  const sorted = (values) => [...new Set(values)].sort();
  return {
    required_cases: sorted(plan.required_cases),
    baseline_cases: sorted(plan.baseline_cases),
    repaired_cases: sorted(plan.repaired_cases),
    impacted_cases: sorted(plan.impacted_cases),
    cases_to_rerun: [...plan.cases_to_rerun]
      .map((entry) => ({
        case_id: entry.case_id,
        reasons: sorted(entry.reasons)
      }))
      .sort((left, right) => left.case_id.localeCompare(right.case_id)),
    reasons_by_case: Object.fromEntries(
      Object.entries(plan.reasons_by_case)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([caseId, reasons]) => [caseId, sorted(reasons)])
    )
  };
}

function evaluateState(
  context,
  store,
  failure,
  authority,
  authorityLog,
  clock
) {
  const classification = classificationEnvelope(
    context,
    store,
    failure.id
  );
  const artifactLossHistory = authorityLog.validate(
    paths(context, failure.id).historicalArtifactLosses,
    'historical_artifact_loss'
  );
  if (!artifactLossHistory.ok) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: artifactLossHistory.blockers
    };
  }
  if (artifactLossHistory.value.length > 1) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: [blocker(
        'verification-repair:historical-artifact-loss-ambiguous',
        failure.id
      )]
    };
  }
  const historicalArtifactLoss = artifactLossHistory.value[0];
  if (historicalArtifactLoss) {
    const machine = kernel.createRepairLoopStateMachine({
      schemaRegistry: context.schemaRegistry,
      trustVerifier: authority,
      rerunScopeAuthority: {
        resolve() {
          return { ok: false };
        }
      },
      clock
    });
    return machine.evaluate({
      classification_result: classification,
      runs: [],
      attempts: [],
      attempt_facts: [],
      historical_artifact_loss: historicalArtifactLoss
    });
  }
  const requestedRepair = readOptionalJson(
    store,
    relativeRepairPath(
      failure.id,
      'repair-link-requested-envelope.json'
    )
  );
  const completedRepair = readOptionalJson(
    store,
    relativeRepairPath(
      failure.id,
      'repair-link-completed-envelope.json'
    )
  );
  const recoveryHistory = authorityLog.validate(
    paths(context, failure.id).repairRecoveries,
    'repair_recovery'
  );
  if (!recoveryHistory.ok) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: recoveryHistory.blockers
    };
  }
  const repairRecovery = recoveryHistory.value.at(-1) || undefined;
  const rebindHistory = authorityLog.validate(
    paths(context, failure.id).repairRebinds,
    'repair_rebind'
  );
  if (!rebindHistory.ok) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: rebindHistory.blockers
    };
  }
  const repairRebind = rebindHistory.value.at(-1) || undefined;
  const effectiveRepairRecovery = repairRebind
    ? undefined
    : repairRecovery;
  const repair = effectiveRepairRecovery || repairRebind
    ? undefined
    : completedRepair || requestedRepair || undefined;
  const rerunHistory = authorityLog.validate(
    paths(context, failure.id).rerunPlans,
    'rerun_plan'
  );
  if (!rerunHistory.ok) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: rerunHistory.blockers
    };
  }
  const rerun = rerunHistory.value.at(-1) || undefined;
  const history = historyFor(context, store, failure);
  let factLog = authorityLog.validate(
    paths(context).attemptFacts,
    'attempt_fact'
  );
  if (!factLog.ok) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: factLog.blockers
    };
  }
  for (const attempt of history.attempts) {
    const appended = authorityLog.append(
      paths(context).attemptFacts,
      'attempt_fact',
      attemptFact(context, store, attempt),
      {
        ...bindings(failure, attempt.id),
        run_id: attempt.run_id,
        case_id: attempt.case_id
      }
    );
    if (!appended.ok) {
      return {
        ok: false,
        status: 'blocked',
        transition_proposal: null,
        blockers: appended.blockers
      };
    }
    factLog = appended;
  }
  const attemptIds = new Set(history.attempts.map((attempt) => attempt.id));
  const facts = factLog.values.filter((envelope) => (
    envelope.bindings.failure_id === failure.id
    && attemptIds.has(envelope.bindings.attempt_id)
  ));
  if (facts.length !== history.attempts.length) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: [blocker(
        'verification-repair:attempt-fact-log-incomplete',
        failure.id
      )]
    };
  }
  const rerunPlan = rerun?.payload || null;
  const machine = kernel.createRepairLoopStateMachine({
    schemaRegistry: context.schemaRegistry,
    trustVerifier: authority,
    rerunScopeAuthority: {
      resolve(request) {
        if (
          !rerunPlan
          || request.failure_id !== failure.id
          || request.change_id !== failure.change_id
          || request.run_id !== failure.run_id
          || request.case_id !== failure.case_id
        ) {
          return { ok: false };
        }
        const scope = scopeProjection(rerunPlan);
        return {
          ok: true,
          scope,
          scope_digest: sha256(canonicalJson(scope))
        };
      }
    },
    clock
  });
  return machine.evaluate({
    classification_result: classification,
    runs: history.runs,
    attempts: history.attempts,
    attempt_facts: facts,
    ...(repair ? { repair_link: repair } : {}),
    ...(effectiveRepairRecovery
      ? { repair_recovery: effectiveRepairRecovery }
      : {}),
    ...(repairRebind ? { repair_rebind: repairRebind } : {}),
    ...(rerun ? { rerun_plan: rerun } : {})
  });
}

function reduceGlobalFailureState(
  context,
  root,
  authority,
  proposals,
  receipts
) {
  return kernel.createFailureStateReducer({
    schemaRegistry: context.schemaRegistry,
    trustVerifier: authority
  }).reduce({
    expected_change_id: context.changeId,
    failures: root.failures,
    raw_failures: root.rawFailures,
    runs: root.runs,
    classification_envelopes: classificationEnvelopeInventory(
      context,
      root
    ),
    transition_proposal_envelopes: proposals,
    transition_receipt_envelopes: receipts
  });
}

function reduceFailureState(
  context,
  root,
  failure,
  authority,
  authorityLog
) {
  const proposals = authorityLog.validate(
    root.files.transitionProposals,
    'transition_proposal'
  );
  const receipts = authorityLog.validate(
    root.files.transitionReceipts,
    'transition_application'
  );
  if (!proposals.ok || !receipts.ok) {
    return {
      ok: false,
      states: [],
      effective_failures: [],
      open_failure_ids: [],
      blockers: [
        ...(proposals.blockers || []),
        ...(receipts.blockers || [])
      ]
    };
  }
  const classification = classificationEnvelope(
    context,
    root.store,
    failure.id
  );
  if (!authority.verify(classification).ok) {
    return {
      ok: false,
      states: [],
      effective_failures: [],
      open_failure_ids: [],
      blockers: [blocker(
        'verification-repair-loop:trusted-envelope-unverified',
        failure.id
      )]
    };
  }
  return reduceGlobalFailureState(
    context,
    root,
    authority,
    proposals.value,
    receipts.value
  );
}

function projectAppliedFailureState(state, failureState, failureId) {
  if (!failureState?.ok) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: failureState?.blockers || [blocker(
        'verification-repair:failure-state-invalid',
        failureId
      )]
    };
  }
  const matches = failureState.states.filter((entry) => (
    entry.failure_id === failureId
  ));
  const effective = failureState.effective_failures.filter((entry) => (
    entry.id === failureId
  ));
  if (matches.length !== 1 || effective.length !== 1) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: [blocker(
        'verification-repair:failure-state-projection-missing',
        failureId
      )]
    };
  }
  const projected = matches[0];
  if (projected.logical_status !== 'closed') return state;
  if (
    effective[0].status !== 'closed'
    || failureState.open_failure_ids.includes(failureId)
    || typeof projected.transition_receipt_id !== 'string'
    || projected.transition_receipt_id.length === 0
  ) {
    return {
      ok: false,
      status: 'blocked',
      transition_proposal: null,
      blockers: [blocker(
        'verification-repair:closed-state-inconsistent',
        failureId
      )]
    };
  }
  return {
    ...state,
    ok: true,
    status: 'closed',
    label: 'pass_after_fix',
    transition_proposal: null,
    transition_receipt_id: projected.transition_receipt_id,
    blockers: []
  };
}

function rootCauseReview(context, changeStore, value, failure) {
  const relative = resolveChangeFile(
    context,
    value,
    'verification-repair:root-cause-check-required'
  );
  const review = readRequiredJson(
    changeStore,
    relative,
    'verification-repair:root-cause-check-read-failed'
  );
  const validated = context.schemaRegistry.validate(
    'root-cause-review',
    review
  );
  if (
    !validated.ok
    || review.failure_id !== failure.id
    || review.root_failure_digest !== sha256(canonicalJson(failure))
    || review.change_id !== failure.change_id
    || review.run_id !== failure.run_id
    || review.case_id !== failure.case_id
    || review.attempt_id !== failure.attempt_id
    || review.reviewer.id !== context.reviewerId
    || Date.parse(review.reviewed_at) < Date.parse(failure.frozen_at)
  ) {
    throw new Error('verification-repair:root-cause-check-invalid');
  }
  return {
    ...validated.value,
    trusted: true
  };
}

function reviewReceipt(
  context,
  changeStore,
  value,
  expectedKind,
  link,
  afterIdentity
) {
  const relative = resolveChangeFile(
    context,
    value,
    `verification-repair:${expectedKind}-required`
  );
  const receipt = readRequiredJson(
    changeStore,
    relative,
    `verification-repair:${expectedKind}-read-failed`
  );
  const validated = context.schemaRegistry.validate(
    'repair-review',
    receipt
  );
  if (
    !validated.ok
    || receipt.kind !== expectedKind
    || receipt.task_id !== link.development_task_id
    || receipt.failure_id !== link.failure_id
    || receipt.repair_link_id !== link.id
    || receipt.repair_link_digest !== sha256(canonicalJson(link))
    || receipt.scope_digest !== link.scope_digest
    || receipt.after_identity_digest
      !== sha256(canonicalJson(afterIdentity))
  ) {
    throw new Error(`verification-repair:${expectedKind}-invalid`);
  }
  return validated.value;
}

function taskMarkdown(task) {
  return {
    'brief.md': [
      `# Verification Repair: ${task.id}`,
      '',
      '## Goal',
      '',
      task.goal,
      '',
      '## Frozen Failure',
      '',
      `- Failure: \`${task.frozen_failure.failure_packet_id}\``,
      `- Attempt: \`${task.frozen_failure.attempt_id}\``,
      `- Classification: \`${task.classification}\``,
      '',
      '## Scope',
      '',
      ...task.scope.allowed_files.map((file) => `- \`${file}\``),
      ''
    ].join('\n'),
    'report.md': [
      `# Repair Report: ${task.id}`,
      '',
      '## Status',
      '',
      'IN PROGRESS',
      '',
      '## Frozen Evidence',
      '',
      ...task.frozen_failure.evidence_ids.map((id) => `- \`${id}\``),
      ''
    ].join('\n'),
    'spec-review.md': '# Spec Review\n\n## Verdict\n\npending\n',
    'quality-review.md': '# Quality Review\n\n## Verdict\n\npending\n'
  };
}

async function run(args = process.argv.slice(2), dependencies = {}) {
  const action = args.find((entry) => !entry.startsWith('--')) || 'state';
  const allowed = [
    'classify',
    'repair-request',
    'repair-start',
    'repair-complete',
    'repair-recover',
    'repair-rebind',
    'artifact-loss-record',
    'rerun-plan',
    'evaluate',
    'transition-apply',
    'state'
  ];
  if (!allowed.includes(action)) {
    return blocked(
      `verification-repair:unsupported-action:${action}`,
      action
    );
  }
  if (args.includes('--no-progress')) {
    return blocked(
      'verification-repair:no-progress-override-forbidden',
      '--no-progress',
      'Loop progress is derived from trusted attempt history.'
    );
  }
  const loaded = loadContext(args, dependencies);
  if (!loaded.ok) return loaded;
  const context = loaded.context;
  const failureId = argValue(args, '--failure-id');
  if (!failureId) {
    return blocked('verification-repair:failure-required', '--failure-id');
  }
  const clock = dependencies.clock || (() => new Date().toISOString());
  const authority = trustAuthority(context, clock);
  const store = kernel.createVerificationArtifactStore({
    changeRoot: context.changeRoot,
    root: context.verificationRoot
  });
  const changeStore = kernel.createVerificationArtifactStore({
    changeRoot: context.changeRoot,
    root: context.changeRoot
  });
  const authorityLog = createAuthorityLog({ store, authority });
  try {
    const root = rootFailure(context, failureId);
    const failure = root.failure;

    if (action === 'artifact-loss-record') {
      const reviewFile = resolveChangeFile(
        context,
        argValue(args, '--artifact-loss-review'),
        'verification-repair:artifact-loss-review-required'
      );
      const review = readRequiredJson(
        changeStore,
        reviewFile,
        'verification-repair:artifact-loss-review-read-failed'
      );
      const validatedReview = context.schemaRegistry.validate(
        'historical-artifact-loss-review',
        review
      );
      const classification = classificationEnvelope(
        context,
        store,
        failure.id
      );
      const classificationVerification = authority.verify(classification);
      if (
        !validatedReview.ok
        || classificationVerification.ok !== true
        || review.failure_id !== failure.id
        || review.change_id !== failure.change_id
        || review.run_id !== failure.run_id
        || review.case_id !== failure.case_id
        || review.attempt_id !== failure.attempt_id
        || review.classification !== classification.payload.packet.classification
        || review.classification_envelope_digest
          !== envelopeDigest(classification)
        || review.reviewer.id !== context.reviewerId
        || review.reviewer.kind !== 'human'
        || review.decision !== 'approved'
        || review.permitted_transition !== 'route_break_loop'
      ) {
        return blocked(
          'verification-repair:artifact-loss-review-invalid',
          reviewFile
        );
      }
      const auditFile = resolveChangeFile(
        context,
        review.recovery_audit_path,
        'verification-repair:artifact-loss-audit-required'
      );
      const auditRead = changeStore.readBytes(auditFile);
      if (
        !auditRead.ok
        || auditRead.missing
        || sha256(auditRead.bytes) !== review.recovery_audit_digest
      ) {
        return blocked(
          'verification-repair:artifact-loss-audit-invalid',
          auditFile
        );
      }
      const auditText = auditRead.bytes.toString('utf8');
      if (
        !auditText.includes('BLOCKED_UNRECOVERABLE')
        || !auditText.includes(
          'verification-history:immutable-run-artifacts-unrecoverable'
        )
        || !auditText.includes(failure.id)
        || !auditText.includes(failure.run_id)
        || !auditText.includes(failure.attempt_id)
      ) {
        return blocked(
          'verification-repair:artifact-loss-audit-binding-mismatch',
          auditFile
        );
      }
      const missingArtifactPaths = [...review.missing_artifact_paths].sort();
      const requiredIntegrityPath = path.posix.join(
        'runs',
        failure.run_id,
        'attempts',
        failure.attempt_id,
        'integrity.json'
      );
      if (
        !missingArtifactPaths.includes(requiredIntegrityPath)
        || missingArtifactPaths.some((artifactPath) => (
          !historicalArtifactPathAllowed(failure, artifactPath)
        ))
      ) {
        return blocked(
          'verification-repair:artifact-loss-path-invalid',
          reviewFile
        );
      }
      for (const artifactPath of missingArtifactPaths) {
        const artifactRead = store.readBytes(artifactPath);
        if (!artifactRead.ok) {
          return {
            ok: false,
            status: 'blocked',
            blockers: artifactRead.blockers,
            fallback_used: false
          };
        }
        if (!artifactRead.missing) {
          return blocked(
            'verification-repair:artifact-loss-artifact-present',
            artifactPath
          );
        }
      }
      const artifactLossCandidate = {
        schema: 'specnav.verification.historical-artifact-loss.v1',
        id: `historical-artifact-loss-${sha256(canonicalJson({
          review_id: review.id,
          failure_id: failure.id,
          classification_envelope_digest:
            review.classification_envelope_digest,
          recovery_audit_digest: review.recovery_audit_digest,
          missing_artifact_paths: missingArtifactPaths
        }))}`,
        failure_id: failure.id,
        change_id: failure.change_id,
        run_id: failure.run_id,
        case_id: failure.case_id,
        attempt_id: failure.attempt_id,
        classification: review.classification,
        status: 'unrecoverable',
        review_id: review.id,
        reviewer: review.reviewer,
        reviewed_at: review.reviewed_at,
        reason: review.reason,
        classification_envelope_digest:
          review.classification_envelope_digest,
        recovery_audit_path: auditFile,
        recovery_audit_digest: review.recovery_audit_digest,
        missing_artifact_paths: missingArtifactPaths,
        permitted_transition: 'route_break_loop',
        recorded_at: review.reviewed_at
      };
      const artifactLoss = context.schemaRegistry.validate(
        'historical-artifact-loss',
        artifactLossCandidate
      );
      if (!artifactLoss.ok) {
        return blocked(
          'verification-repair:artifact-loss-contract-invalid',
          failure.id
        );
      }
      const existing = authorityLog.validate(
        paths(context, failure.id).historicalArtifactLosses,
        'historical_artifact_loss'
      );
      if (!existing.ok) {
        return {
          ok: false,
          status: 'blocked',
          blockers: existing.blockers,
          fallback_used: false
        };
      }
      if (
        existing.value.length > 0
        && canonicalJson(existing.value[0].payload)
          !== canonicalJson(artifactLoss.value)
      ) {
        return blocked(
          'verification-repair:artifact-loss-authority-conflict',
          failure.id
        );
      }
      const persisted = authorityLog.append(
        paths(context, failure.id).historicalArtifactLosses,
        'historical_artifact_loss',
        artifactLoss.value,
        bindings(failure, failure.attempt_id)
      );
      if (!persisted.ok) {
        return {
          ok: false,
          status: 'blocked',
          blockers: persisted.blockers,
          fallback_used: false
        };
      }
      return {
        ok: true,
        status: 'historical_artifact_loss_recorded',
        failure_id: failure.id,
        artifact_loss_id: artifactLoss.value.id,
        envelope_id: persisted.envelope.id,
        replayed: !persisted.appended,
        blockers: [],
        fallback_used: false
      };
    }

    if (action === 'classify') {
      const check = rootCauseReview(
        context,
        changeStore,
        argValue(args, '--root-cause-check'),
        failure
      );
      const allReadings = readRequiredJson(
        store,
        root.files.readings,
        'verification-repair:readings-read-failed'
      );
      const requiredReadingIds = new Set(failure.reading_ids);
      const readings = allReadings.filter((reading) => (
        requiredReadingIds.has(reading.id)
      ));
      const result = kernel.createFailureClassifier({
        schemaRegistry: context.schemaRegistry,
        rootCauseChecks: [check],
        clock
      }).classify({
        source_failure_packet: failure,
        readings,
        evidence: evidenceFor(context, store, failure.evidence_ids),
        integrity: classifierIntegrity(context, store, failure),
        root_cause_check_id: check.id
      });
      if (!result.ok) return { ...result, fallback_used: false };
      const envelope = authority.seal(
        'classification_result',
        result,
        bindings(failure)
      );
      const persisted = persistTrustedEnvelope(
        store,
        relativeRepairPath(failure.id, 'classification-envelope.json'),
        envelope,
        authority
      );
      writeJson(
        store,
        relativeRepairPath(failure.id, 'classification-view.json'),
        result.packet
      );
      return {
        ok: true,
        status: 'classified',
        failure_id: failure.id,
        classification: result.packet.classification,
        envelope_id: persisted.envelope.id,
        replayed: !persisted.persisted,
        blockers: [],
        fallback_used: false
      };
    }

    if (action === 'repair-request') {
      const classifiedEnvelope = classificationEnvelope(
        context,
        store,
        failure.id
      );
      if (!authority.verify(classifiedEnvelope).ok) {
        return blocked(
          'verification-repair:classification-envelope-invalid',
          classifiedEnvelope.id
        );
      }
      const existingLinkValue = readOptionalJson(
        store,
        relativeRepairPath(failure.id, 'repair-link.json')
      );
      if (existingLinkValue) {
        const originalIdentity = attemptFingerprint(
          initialAttempt(context, store, failure)
        );
        const existingLink = context.schemaRegistry.validate(
          'repair-link',
          existingLinkValue
        );
        if (
          !existingLink.ok
          || existingLink.value.failure_id !== failure.id
          || existingLink.value.change_id !== failure.change_id
          || fingerprintDrift(
            originalIdentity,
            existingLink.value.before_identity
          ).length > 0
        ) {
          return blocked(
            'verification-repair:repair-link-invalid',
            failure.id,
            existingLink.ok
              ? fingerprintDrift(
                  originalIdentity,
                  existingLink.value.before_identity
                ).join(',')
              : null
          );
        }
        const links = readOptionalJson(store, root.files.repairLinks, []);
        writeJson(store, 'v2/repair-links.json', mergeById(
          links,
          [existingLink.value]
        ));
        return {
          ok: true,
          status: existingLink.value.status === 'completed'
            ? 'repair_completed'
            : 'repair_requested',
          failure_id: failure.id,
          development_task_id: existingLink.value.development_task_id,
          repair_link_id: existingLink.value.id,
          replayed: true,
          blockers: [],
          fallback_used: false
        };
      }
      const scopeFile = resolveChangeFile(
        context,
        argValue(args, '--scope'),
        'verification-repair:scope-required'
      );
      const attempt = initialAttempt(context, store, failure);
      const result = kernel.createDevelopmentRepairBridge({
        schemaRegistry: context.schemaRegistry,
        clock
      }).routeRepair({
        failure_packet: classifiedEnvelope.payload.packet,
        evidence: evidenceFor(context, store, failure.evidence_ids),
        attempt,
        before_identity: attemptFingerprint(attempt),
        scope_lock: readRequiredJson(
          changeStore,
          scopeFile,
          'verification-repair:scope-read-failed'
        ),
        verification_mode: 'full',
        fallback_used: false,
        manual_green: false
      });
      if (!result.ok) return { ...result, fallback_used: false };
      const taskRoot = path.posix.join(
        'development',
        'tasks',
        result.development_task.id
      );
      writeJson(
        changeStore,
        `${taskRoot}/context.json`,
        result.development_task
      );
      for (const [name, content] of Object.entries(
        taskMarkdown(result.development_task)
      )) {
        writeText(changeStore, `${taskRoot}/${name}`, content);
      }
      const requestedEnvelope = authority.seal(
        'repair_link',
        result.repair_link,
        bindings(failure)
      );
      persistTrustedEnvelope(
        store,
        relativeRepairPath(
          failure.id,
          'repair-link-requested-envelope.json'
        ),
        requestedEnvelope,
        authority
      );
      const links = readOptionalJson(store, root.files.repairLinks, []);
      writeJson(store, 'v2/repair-links.json', mergeById(
        links,
        [result.repair_link]
      ));
      writeJson(
        store,
        relativeRepairPath(failure.id, 'repair-task.json'),
        result.development_task
      );
      writeJson(
        store,
        relativeRepairPath(failure.id, 'repair-link.json'),
        result.repair_link
      );
      return {
        ok: true,
        status: 'repair_requested',
        failure_id: failure.id,
        development_task_id: result.development_task.id,
        repair_link_id: result.repair_link.id,
        blockers: [],
        fallback_used: false
      };
    }

    if (action === 'repair-start') {
      const requested = loadEnvelope(
        context,
        store,
        failure.id,
        'repair-link-requested-envelope.json'
      );
      const originalIdentity = attemptFingerprint(
        initialAttempt(context, store, failure)
      );
      if (
        !authority.verify(requested).ok
        || requested.kind !== 'repair_link'
        || requested.bindings.failure_id !== failure.id
        || requested.payload.failure_id !== failure.id
        || requested.payload.change_id !== failure.change_id
        || requested.payload.status !== 'requested'
        || fingerprintDrift(
          originalIdentity,
          requested.payload.before_identity
        ).length > 0
      ) {
        return blocked(
          'verification-repair:repair-link-envelope-invalid',
          failure.id
        );
      }
      const existing = readOptionalJson(
        store,
        relativeRepairPath(
          failure.id,
          'repair-link-started-envelope.json'
        )
      );
      if (existing) {
        const baselineEnvelope = readOptionalJson(
          store,
          relativeRepairPath(
            failure.id,
            'repair-baseline-envelope.json'
          )
        );
        if (
          !authority.verify(existing).ok
          || existing.kind !== 'repair_link'
          || existing.bindings.failure_id !== failure.id
          || existing.payload.failure_id !== failure.id
          || existing.payload.status !== 'in_progress'
          || repairLineageDrift(
            requested.payload,
            existing.payload
          ).length > 0
        ) {
          return blocked(
            'verification-repair:repair-baseline-invalid',
            failure.id,
            repairLineageDrift(
              requested.payload,
              existing.payload
            ).join(',')
          );
        }
        if (
          !baselineEnvelope
          || !authority.verify(baselineEnvelope).ok
          || baselineEnvelope.kind !== 'repair_baseline'
          || baselineEnvelope.payload.failure_id !== failure.id
          || baselineEnvelope.payload.repair_link_id !== existing.payload.id
          || baselineEnvelope.payload.repair_link_digest
            !== sha256(canonicalJson(existing.payload))
          || fingerprintDrift(
            existing.payload.before_identity,
            baselineEnvelope.payload.before_identity
          ).length > 0
        ) {
          return blocked(
            'verification-repair:repair-baseline-record-invalid',
            failure.id
          );
        }
        writeJson(
          store,
          relativeRepairPath(failure.id, 'repair-link.json'),
          existing.payload
        );
        return {
          ok: true,
          status: 'repair_in_progress',
          failure_id: failure.id,
          repair_link_id: existing.payload.id,
          baseline_identity: existing.payload.before_identity,
          baseline_revision: baselineEnvelope.payload.git_revision,
          envelope_id: existing.id,
          replayed: true,
          blockers: [],
          fallback_used: false
        };
      }
      const current = (dependencies.fingerprints || fingerprints)(
        context.projectRoot,
        context.snapshotValue,
        context.runtimeStatusValue,
        context.runtimeAuthority
      );
      const currentIdentity = currentFingerprint(context, current);
      const drift = fingerprintDrift(
        requested.payload.before_identity,
        currentIdentity
      );
      if (drift.length > 0) {
        return blocked(
          'verification-repair:repair-baseline-drift',
          failure.id,
          drift.join(',')
        );
      }
      const baseline = context.schemaRegistry.validate('repair-link', {
        ...requested.payload,
        status: 'in_progress',
        before_identity: requested.payload.before_identity
      });
      if (!baseline.ok) {
        return blocked(
          'verification-repair:repair-baseline-invalid',
          failure.id
        );
      }
      const envelope = authority.seal(
        'repair_link',
        baseline.value,
        bindings(failure)
      );
      const persisted = persistTrustedEnvelope(
        store,
        relativeRepairPath(
          failure.id,
          'repair-link-started-envelope.json'
        ),
        envelope,
        authority
      );
      const gitRevision = (
        dependencies.gitRevision || currentGitRevision
      )(context.projectRoot);
      const baselineEnvelope = repairBaseline(
        context,
        authority,
        failure,
        baseline.value,
        gitRevision,
        clock
      );
      persistTrustedEnvelope(
        store,
        relativeRepairPath(
          failure.id,
          'repair-baseline-envelope.json'
        ),
        baselineEnvelope,
        authority
      );
      const links = readOptionalJson(store, root.files.repairLinks, []);
      writeJson(store, root.files.repairLinks, mergeById(
        links,
        [baseline.value]
      ));
      writeJson(
        store,
        relativeRepairPath(failure.id, 'repair-link.json'),
        baseline.value
      );
      return {
        ok: true,
        status: 'repair_in_progress',
        failure_id: failure.id,
        repair_link_id: baseline.value.id,
        baseline_identity: baseline.value.before_identity,
        baseline_revision: gitRevision,
        envelope_id: persisted.envelope.id,
        replayed: !persisted.persisted,
        blockers: [],
        fallback_used: false
      };
    }

    if (action === 'repair-complete') {
      const requestedEnvelope = loadEnvelope(
        context,
        store,
        failure.id,
        'repair-link-requested-envelope.json'
      );
      const originalIdentity = attemptFingerprint(
        initialAttempt(context, store, failure)
      );
      if (
        !authority.verify(requestedEnvelope).ok
        || requestedEnvelope.kind !== 'repair_link'
        || requestedEnvelope.bindings.failure_id !== failure.id
        || requestedEnvelope.payload.failure_id !== failure.id
        || requestedEnvelope.payload.change_id !== failure.change_id
        || requestedEnvelope.payload.status !== 'requested'
        || fingerprintDrift(
          originalIdentity,
          requestedEnvelope.payload.before_identity
        ).length > 0
      ) {
        return blocked(
          'verification-repair:repair-link-envelope-invalid',
          failure.id
        );
      }
      const completedEnvelope = readOptionalJson(
        store,
        relativeRepairPath(
          failure.id,
          'repair-link-completed-envelope.json'
        )
      );
      if (completedEnvelope) {
        if (
          !authority.verify(completedEnvelope).ok
          || completedEnvelope.kind !== 'repair_link'
          || completedEnvelope.bindings.failure_id !== failure.id
          || completedEnvelope.payload.failure_id !== failure.id
          || completedEnvelope.payload.status !== 'completed'
          || repairLineageDrift(
            requestedEnvelope.payload,
            completedEnvelope.payload
          ).length > 0
        ) {
          return blocked(
            'verification-repair:repair-link-envelope-invalid',
            failure.id,
            repairLineageDrift(
              requestedEnvelope.payload,
              completedEnvelope.payload
            ).join(',')
          );
        }
        const links = readOptionalJson(store, root.files.repairLinks, []);
        writeJson(store, 'v2/repair-links.json', mergeById(
          links,
          [completedEnvelope.payload]
        ));
        return {
          ok: true,
          status: 'repair_completed',
          failure_id: failure.id,
          repair_link_id: completedEnvelope.payload.id,
          after_identity: completedEnvelope.payload.after_identity,
          envelope_id: completedEnvelope.id,
          replayed: true,
          blockers: [],
          fallback_used: false
        };
      }
      const startedEnvelope = loadEnvelope(
        context,
        store,
        failure.id,
        'repair-link-started-envelope.json'
      );
      if (
        !authority.verify(startedEnvelope).ok
        || startedEnvelope.kind !== 'repair_link'
        || startedEnvelope.payload.status !== 'in_progress'
        || repairLineageDrift(
          requestedEnvelope.payload,
          startedEnvelope.payload
        ).length > 0
      ) {
        return blocked(
          'verification-repair:repair-baseline-invalid',
          failure.id,
          repairLineageDrift(
            requestedEnvelope.payload,
            startedEnvelope.payload
          ).join(',')
        );
      }
      const baselineEnvelope = loadEnvelope(
        context,
        store,
        failure.id,
        'repair-baseline-envelope.json'
      );
      if (
        !authority.verify(baselineEnvelope).ok
        || baselineEnvelope.kind !== 'repair_baseline'
        || baselineEnvelope.bindings.failure_id !== failure.id
        || baselineEnvelope.payload.failure_id !== failure.id
        || baselineEnvelope.payload.repair_link_id
          !== startedEnvelope.payload.id
        || baselineEnvelope.payload.repair_link_digest
          !== sha256(canonicalJson(startedEnvelope.payload))
        || fingerprintDrift(
          startedEnvelope.payload.before_identity,
          baselineEnvelope.payload.before_identity
        ).length > 0
      ) {
        return blocked(
          'verification-repair:repair-baseline-record-invalid',
          failure.id
        );
      }
      const currentLink = startedEnvelope.payload;
      const specReviewArg = argValue(args, '--spec-review');
      const qualityReviewArg = argValue(args, '--quality-review');
      const specReviewFile = resolveChangeFile(
        context,
        specReviewArg,
        'verification-repair:spec-review-required'
      );
      const qualityReviewFile = resolveChangeFile(
        context,
        qualityReviewArg,
        'verification-repair:quality-review-required'
      );
      const reviewPaths = [specReviewFile, qualityReviewFile].map((file) => (
        path.posix.join(
          'openspec',
          'changes',
          context.changeId,
          file
        )
      ));
      const current = (
        dependencies.repairFingerprints
        || dependencies.fingerprints
        || repairCompletionFingerprints
      )(
        context.projectRoot,
        context.snapshotValue,
        context.runtimeStatusValue,
        context.runtimeAuthority,
        reviewPaths
      );
      const after = {
        case_snapshot_hash: context.snapshotValue.snapshot_hash,
        code_sha: current.codeSha,
        test_sha: current.testSha,
        environment_hash: current.environmentHash,
        runtime_version: context.runtimeStatusValue.runtime_version,
        kernel_version: kernel.metadata.version
      };
      const afterRevision = current.gitRevision || (
        dependencies.gitRevision || currentGitRevision
      )(context.projectRoot);
      const task = readRequiredJson(
        changeStore,
        path.posix.join(
          'development',
          'tasks',
          currentLink.development_task_id,
          'context.json'
        ),
        'verification-repair:repair-task-read-failed'
      );
      if (
        task.id !== currentLink.development_task_id
        || task.change_id !== failure.change_id
        || sha256(canonicalJson(task.scope)) !== currentLink.scope_digest
      ) {
        return blocked(
          'verification-repair:repair-task-invalid',
          currentLink.development_task_id
        );
      }
      const diffValidation = (
        dependencies.validateRepairDiff || validateRepairDiff
      )({
        projectRoot: context.projectRoot,
        changeId: context.changeId,
        failureId: failure.id,
        task,
        beforeIdentity: currentLink.before_identity,
        afterIdentity: after,
        beforeRevision: baselineEnvelope.payload.git_revision,
        afterRevision
      });
      if (!diffValidation.ok) return diffValidation;
      const reviews = [
        reviewReceipt(
          context,
          changeStore,
          specReviewArg,
          'spec-review',
          currentLink,
          after
        ),
        reviewReceipt(
          context,
          changeStore,
          qualityReviewArg,
          'quality-review',
          currentLink,
          after
        )
      ];
      const result = kernel.createDevelopmentRepairBridge({
        schemaRegistry: context.schemaRegistry,
        clock
      }).completeRepair({
        repair_link: currentLink,
        after_identity: after,
        reviews
      });
      if (!result.ok) return { ...result, fallback_used: false };
      const envelope = authority.seal(
        'repair_link',
        result.repair_link,
        bindings(failure)
      );
      const persisted = persistTrustedEnvelope(
        store,
        relativeRepairPath(
          failure.id,
          'repair-link-completed-envelope.json'
        ),
        envelope,
        authority
      );
      const links = readOptionalJson(store, root.files.repairLinks, []);
      writeJson(store, 'v2/repair-links.json', mergeById(
        links,
        [result.repair_link]
      ));
      writeJson(
        store,
        relativeRepairPath(failure.id, 'repair-link.json'),
        result.repair_link
      );
      return {
        ok: true,
        status: 'repair_completed',
        failure_id: failure.id,
        repair_link_id: result.repair_link.id,
        after_identity: result.repair_link.after_identity,
        verified_changes: diffValidation.changes,
        envelope_id: persisted.envelope.id,
        replayed: !persisted.persisted,
        blockers: [],
        fallback_used: false
      };
    }

    if (action === 'repair-recover') {
      const reviewFile = resolveChangeFile(
        context,
        argValue(args, '--recovery-review'),
        'verification-repair:recovery-review-required'
      );
      const review = readRequiredJson(
        changeStore,
        reviewFile,
        'verification-repair:recovery-review-read-failed'
      );
      const validatedReview = context.schemaRegistry.validate(
        'repair-lineage-recovery-review',
        review
      );
      if (
        !validatedReview.ok
        || review.failure_id !== failure.id
        || review.change_id !== failure.change_id
        || review.classification
          !== classificationEnvelope(context, store, failure.id)
            .payload.packet.classification
        || review.reviewer.id !== context.reviewerId
        || review.reviewer.kind !== 'human'
        || review.decision !== 'approved'
      ) {
        return blocked(
          'verification-repair:recovery-review-invalid',
          reviewFile
        );
      }
      const requestedEnvelope = loadEnvelope(
        context,
        store,
        failure.id,
        'repair-link-requested-envelope.json'
      );
      if (
        !authority.verify(requestedEnvelope).ok
        || requestedEnvelope.kind !== 'repair_link'
        || requestedEnvelope.payload.status !== 'requested'
        || requestedEnvelope.payload.failure_id !== failure.id
        || fingerprintDrift(
          attemptFingerprint(initialAttempt(context, store, failure)),
          requestedEnvelope.payload.before_identity
        ).length > 0
        || review.requested_envelope_digest
          !== envelopeDigest(requestedEnvelope)
      ) {
        return blocked(
          'verification-repair:recovery-requested-envelope-invalid',
          failure.id
        );
      }
      const invalidNames = [
        'repair-link-started-envelope.json',
        'repair-link-completed-envelope.json'
      ];
      const actualInvalid = [];
      for (const name of invalidNames) {
        const envelope = loadEnvelope(
          context,
          store,
          failure.id,
          name
        );
        const drift = repairLineageDrift(
          requestedEnvelope.payload,
          envelope.payload
        );
        if (
          !authority.verify(envelope).ok
          || envelope.kind !== 'repair_link'
          || drift.length === 0
        ) {
          return blocked(
            'verification-repair:recovery-invalid-lineage-not-proven',
            name
          );
        }
        actualInvalid.push({
          artifact: name,
          envelope_digest: envelopeDigest(envelope),
          drift_fields: [...drift].sort()
        });
      }
      const expectedInvalid = [...review.invalid_envelopes]
        .map((entry) => ({
          ...entry,
          drift_fields: [...entry.drift_fields].sort()
        }))
        .sort((left, right) => left.artifact.localeCompare(right.artifact));
      actualInvalid.sort((left, right) => (
        left.artifact.localeCompare(right.artifact)
      ));
      if (canonicalJson(actualInvalid) !== canonicalJson(expectedInvalid)) {
        return blocked(
          'verification-repair:recovery-invalid-lineage-mismatch',
          failure.id
        );
      }
      const current = (dependencies.fingerprints || fingerprints)(
        context.projectRoot,
        context.snapshotValue,
        context.runtimeStatusValue,
        context.runtimeAuthority
      );
      const afterIdentity = currentFingerprint(context, current);
      if (
        review.expected_current_identity_digest
          !== sha256(canonicalJson(afterIdentity))
      ) {
        return blocked(
          'verification-repair:recovery-current-identity-mismatch',
          failure.id
        );
      }
      const protectedDrift = [
        'case_snapshot_hash',
        'environment_hash',
        'runtime_version',
        'kernel_version'
      ].filter((field) => (
        requestedEnvelope.payload.before_identity[field]
          !== afterIdentity[field]
      )).sort();
      if (
        canonicalJson(protectedDrift)
          !== canonicalJson([...review.allowed_identity_drift].sort())
      ) {
        return blocked(
          'verification-repair:recovery-drift-approval-mismatch',
          failure.id,
          protectedDrift.join(',')
        );
      }
      const task = readRequiredJson(
        changeStore,
        path.posix.join(
          'development',
          'tasks',
          requestedEnvelope.payload.development_task_id,
          'context.json'
        ),
        'verification-repair:repair-task-read-failed'
      );
      const diffValidation = (
        dependencies.validateRepairDiff || validateRepairDiff
      )({
        projectRoot: context.projectRoot,
        changeId: context.changeId,
        failureId: failure.id,
        task,
        beforeIdentity: requestedEnvelope.payload.before_identity,
        afterIdentity,
        beforeRevision: review.repair_revision_range.before_revision,
        afterRevision: review.repair_revision_range.after_revision
      });
      if (!diffValidation.ok) return diffValidation;
      const startedEnvelope = loadEnvelope(
        context,
        store,
        failure.id,
        'repair-link-started-envelope.json'
      );
      const historicalAfter = loadEnvelope(
        context,
        store,
        failure.id,
        'repair-link-completed-envelope.json'
      ).payload.after_identity;
      const historicalReviews = [
        reviewReceipt(
          context,
          changeStore,
          argValue(args, '--spec-review'),
          'spec-review',
          startedEnvelope.payload,
          historicalAfter
        ),
        reviewReceipt(
          context,
          changeStore,
          argValue(args, '--quality-review'),
          'quality-review',
          startedEnvelope.payload,
          historicalAfter
        )
      ];
      const completedAt = clock();
      const recoveredLinkCandidate = {
        ...requestedEnvelope.payload,
        id: `repair-recovered-${sha256(canonicalJson({
          failure_id: failure.id,
          review_id: review.id,
          after_identity: afterIdentity
        }))}`,
        status: 'completed',
        completed_at: completedAt,
        before_identity: requestedEnvelope.payload.before_identity,
        after_identity: afterIdentity,
        review_evidence_ids: historicalReviews
          .map((entry) => entry.evidence_id)
          .sort()
      };
      const recoveredLink = context.schemaRegistry.validate(
        'repair-link',
        recoveredLinkCandidate
      );
      if (!recoveredLink.ok) {
        return blocked(
          'verification-repair:recovered-link-invalid',
          failure.id
        );
      }
      const recoveryCandidate = {
        ...validatedReview.value,
        schema: 'specnav.verification.repair-lineage-recovery.v1',
        id: `repair-lineage-recovery-${sha256(canonicalJson({
          review_id: review.id,
          recovered_link_id: recoveredLink.value.id
        }))}`,
        recovered_repair_link: recoveredLink.value,
        verified_changes: diffValidation.changes
      };
      const recovery = context.schemaRegistry.validate(
        'repair-lineage-recovery',
        recoveryCandidate
      );
      if (!recovery.ok) {
        return blocked(
          'verification-repair:recovery-contract-invalid',
          failure.id
        );
      }
      const envelope = authority.seal(
        'repair_recovery',
        recovery.value,
        bindings(failure)
      );
      const persisted = appendTrustedEnvelopeHistory({
        authorityLog,
        authority,
        relative: paths(context, failure.id).repairRecoveries,
        kind: 'repair_recovery',
        payload: recovery.value,
        expectedBindings: bindings(failure),
        legacyEnvelope: readOptionalJson(
          store,
          relativeRepairPath(
            failure.id,
            'repair-lineage-recovery-envelope.json'
          )
        )
      });
      writeJson(
        store,
        relativeRepairPath(
          failure.id,
          'repair-link-recovered.json'
        ),
        recoveredLink.value
      );
      const links = readOptionalJson(store, root.files.repairLinks, []);
      writeJson(store, root.files.repairLinks, mergeById(
        links,
        [recoveredLink.value]
      ));
      return {
        ok: true,
        status: 'repair_recovered',
        failure_id: failure.id,
        repair_link_id: recoveredLink.value.id,
        after_identity: afterIdentity,
        verified_changes: diffValidation.changes,
        envelope_id: persisted.envelope.id,
        replayed: !persisted.appended,
        blockers: [],
        fallback_used: false
      };
    }

    if (action === 'repair-rebind') {
      const reviewFile = resolveChangeFile(
        context,
        argValue(args, '--rebind-review'),
        'verification-repair:rebind-review-required'
      );
      const review = readRequiredJson(
        changeStore,
        reviewFile,
        'verification-repair:rebind-review-read-failed'
      );
      const validatedReview = context.schemaRegistry.validate(
        'repair-generation-rebind-review',
        review
      );
      const classification = classificationEnvelope(
        context,
        store,
        failure.id
      ).payload.packet.classification;
      if (
        !validatedReview.ok
        || review.failure_id !== failure.id
        || review.change_id !== failure.change_id
        || review.classification !== classification
        || review.reviewer.id !== context.reviewerId
        || review.reviewer.kind !== 'human'
        || review.decision !== 'approved'
      ) {
        return blocked(
          'verification-repair:rebind-review-invalid',
          reviewFile
        );
      }
      const recoveryHistory = authorityLog.validate(
        paths(context, failure.id).repairRecoveries,
        'repair_recovery'
      );
      const rebindHistory = authorityLog.validate(
        paths(context, failure.id).repairRebinds,
        'repair_rebind'
      );
      if (!recoveryHistory.ok || !rebindHistory.ok) {
        return {
          ok: false,
          status: 'blocked',
          blockers: [
            ...(recoveryHistory.blockers || []),
            ...(rebindHistory.blockers || [])
          ],
          fallback_used: false
        };
      }
      const current = (dependencies.fingerprints || fingerprints)(
        context.projectRoot,
        context.snapshotValue,
        context.runtimeStatusValue,
        context.runtimeAuthority,
        null,
        [path.posix.join(
          'openspec',
          'changes',
          context.changeId,
          reviewFile
        )]
      );
      const afterIdentity = currentFingerprint(context, current);
      const existingRebind = rebindHistory.value.find((envelope) => {
        const payload = envelope.payload;
        return payload.failure_id === review.failure_id
          && payload.change_id === review.change_id
          && payload.classification === review.classification
          && payload.decision === review.decision
          && canonicalJson(payload.reviewer)
            === canonicalJson(review.reviewer)
          && payload.reviewed_at === review.reviewed_at
          && payload.reason === review.reason
          && payload.previous_repair_link_digest
            === review.previous_repair_link_digest
          && canonicalJson(payload.repair_revision_range)
            === canonicalJson(review.repair_revision_range)
          && canonicalJson(payload.reviewed_files)
            === canonicalJson(review.reviewed_files)
          && payload.expected_current_identity_digest
            === review.expected_current_identity_digest
          && payload.rebound_repair_link.review_evidence_ids.includes(
            review.id
          );
      });
      if (existingRebind) {
        if (
          canonicalJson(existingRebind.payload.rebound_repair_link.after_identity)
            !== canonicalJson(afterIdentity)
        ) {
          return blocked(
            'verification-repair:rebind-current-identity-mismatch',
            failure.id
          );
        }
        return {
          ok: true,
          status: 'repair_rebound',
          failure_id: failure.id,
          repair_link_id: existingRebind.payload.rebound_repair_link.id,
          after_identity: afterIdentity,
          verified_changes: existingRebind.payload.verified_changes,
          envelope_id: existingRebind.id,
          replayed: true,
          blockers: [],
          fallback_used: false
        };
      }
      const previousLink = rebindHistory.value.at(-1)?.payload
        .rebound_repair_link
        || recoveryHistory.value.at(-1)?.payload.recovered_repair_link
        || readRequiredJson(
          store,
          relativeRepairPath(failure.id, 'repair-link.json'),
          'verification-repair:repair-link-read-failed'
        );
      if (
        previousLink.status !== 'completed'
        || review.previous_repair_link_digest
          !== sha256(canonicalJson(previousLink))
      ) {
        return blocked(
          'verification-repair:rebind-previous-link-mismatch',
          failure.id
        );
      }
      if (
        review.expected_current_identity_digest
          !== sha256(canonicalJson(afterIdentity))
      ) {
        return blocked(
          'verification-repair:rebind-current-identity-mismatch',
          failure.id
        );
      }
      const task = readRequiredJson(
        changeStore,
        path.posix.join(
          'development',
          'tasks',
          previousLink.development_task_id,
          'context.json'
        ),
        'verification-repair:repair-task-read-failed'
      );
      const diffValidation = (
        dependencies.validateRepairRebindScope || validateRepairRebindScope
      )({
        projectRoot: context.projectRoot,
        task,
        afterRevision: review.repair_revision_range.after_revision,
        reviewedFiles: review.reviewed_files
      });
      if (!diffValidation.ok) return diffValidation;
      const reboundLink = context.schemaRegistry.assertValid('repair-link', {
        ...previousLink,
        id: `repair-rebound-${sha256(canonicalJson({
          failure_id: failure.id,
          review_id: review.id,
          after_identity: afterIdentity
        }))}`,
        completed_at: clock(),
        after_identity: afterIdentity,
        review_evidence_ids: [
          ...new Set([
            ...(previousLink.review_evidence_ids || []),
            review.id
          ])
        ].sort()
      });
      const rebind = context.schemaRegistry.assertValid(
        'repair-generation-rebind',
        {
          ...validatedReview.value,
          schema: 'specnav.verification.repair-generation-rebind.v1',
          id: `repair-generation-rebind-${sha256(canonicalJson({
            review_id: review.id,
            rebound_repair_link_id: reboundLink.id
          }))}`,
          previous_repair_link: previousLink,
          rebound_repair_link: reboundLink,
          verified_changes: diffValidation.changes
        }
      );
      const persisted = appendTrustedEnvelopeHistory({
        authorityLog,
        authority,
        relative: paths(context, failure.id).repairRebinds,
        kind: 'repair_rebind',
        payload: rebind,
        expectedBindings: bindings(failure)
      });
      writeJson(
        store,
        relativeRepairPath(failure.id, 'repair-link-rebound.json'),
        reboundLink
      );
      writeJson(
        store,
        relativeRepairPath(failure.id, 'repair-link.json'),
        reboundLink
      );
      const links = readOptionalJson(store, root.files.repairLinks, []);
      writeJson(store, root.files.repairLinks, mergeById(
        links,
        [reboundLink]
      ));
      return {
        ok: true,
        status: 'repair_rebound',
        failure_id: failure.id,
        repair_link_id: reboundLink.id,
        after_identity: afterIdentity,
        verified_changes: diffValidation.changes,
        envelope_id: persisted.envelope.id,
        replayed: !persisted.appended,
        blockers: [],
        fallback_used: false
      };
    }

    if (action === 'rerun-plan') {
      const scope = (
        dependencies.computeRerunScope || computeRerunScope
      )(context.projectRoot, {
        change: context.changeId,
        files: [],
        repairedCaseIds: [failure.case_id],
        expectedReviewerId: context.reviewerId,
        schemaRegistry: context.schemaRegistry
      });
      if (!scope.ok) return { ...scope, fallback_used: false };
      const persisted = appendTrustedEnvelopeHistory({
        authorityLog,
        authority,
        relative: paths(context, failure.id).rerunPlans,
        kind: 'rerun_plan',
        payload: scope,
        expectedBindings: bindings(failure),
        legacyEnvelope: readOptionalJson(
          store,
          relativeRepairPath(failure.id, 'rerun-plan-envelope.json')
        )
      });
      writeJson(
        store,
        relativeRepairPath(failure.id, 'rerun-plan.json'),
        scope
      );
      return {
        ok: true,
        status: 'rerun_planned',
        failure_id: failure.id,
        required_cases: scope.required_cases,
        scope_digest: sha256(canonicalJson(scopeProjection(scope))),
        envelope_id: persisted.envelope.id,
        replayed: !persisted.appended,
        blockers: [],
        fallback_used: false
      };
    }

    const state = evaluateState(
      context,
      store,
      failure,
      authority,
      authorityLog,
      clock
    );
    writeJson(
      store,
      relativeRepairPath(failure.id, 'repair-state.json'),
      state
    );
    if (state.transition_proposal) {
      const proposalLog = authorityLog.append(
        root.files.transitionProposals,
        'transition_proposal',
        state.transition_proposal,
        bindings(failure)
      );
      if (!proposalLog.ok) {
        return {
          ok: false,
          status: 'blocked',
          blockers: proposalLog.blockers,
          fallback_used: false
        };
      }
    }

    if (action === 'transition-apply') {
      const proposalId = argValue(args, '--proposal-id');
      const idempotencyKey = argValue(args, '--idempotency-key');
      if (!proposalId) {
        return blocked(
          'verification-repair:proposal-required',
          '--proposal-id'
        );
      }
      if (!idempotencyKey) {
        return blocked(
          'verification-repair:idempotency-key-required',
          '--idempotency-key'
        );
      }
      if (
        !state.ok
        || !state.transition_proposal
        || !['close_failure', 'reopen_failure', 'route_break_loop'].includes(
          state.transition_proposal.action
        )
      ) {
        return blocked(
          'verification-repair:transition-not-applicable',
          failure.id,
          state.status,
          { state }
        );
      }
      if (state.transition_proposal.id !== proposalId) {
        return blocked(
          'verification-repair:proposal-mismatch',
          proposalId,
          state.transition_proposal.id
        );
      }
      const proposals = authorityLog.validate(
        root.files.transitionProposals,
        'transition_proposal'
      );
      const receipts = authorityLog.validate(
        root.files.transitionReceipts,
        'transition_application'
      );
      if (!proposals.ok || !receipts.ok) {
        return {
          ok: false,
          status: 'blocked',
          blockers: [
            ...(proposals.blockers || []),
            ...(receipts.blockers || [])
          ],
          fallback_used: false
        };
      }
      const classification = classificationEnvelope(
        context,
        store,
        failure.id
      );
      if (!authority.verify(classification).ok) {
        return blocked(
          'verification-repair:classification-envelope-invalid',
          failure.id
        );
      }
      const applied = kernel.createTransitionApplier({
        schemaRegistry: context.schemaRegistry,
        trustVerifier: authority,
        clock
      }).apply({
        root_failure: failure,
        effective_failure: classification.payload.packet,
        proposal_id: proposalId,
        idempotency_key: idempotencyKey,
        proposal_envelopes: envelopesForFailure(
          proposals.value,
          failure.id
        ),
        receipt_envelopes: envelopesForFailure(
          receipts.value,
          failure.id
        )
      });
      if (!applied.ok) return { ...applied, fallback_used: false };
      let receiptLog = receipts.value;
      if (applied.status !== 'already_applied') {
        const appended = authorityLog.append(
          root.files.transitionReceipts,
          'transition_application',
          applied.receipt,
          bindings(failure)
        );
        if (!appended.ok) {
          return {
            ok: false,
            status: 'blocked',
            blockers: appended.blockers,
            fallback_used: false
          };
        }
        receiptLog = appended.values;
      }
      const failureState = reduceGlobalFailureState(
        context,
        root,
        authority,
        proposals.value,
        receiptLog
      );
      if (!failureState.ok) {
        return {
          ...failureState,
          status: 'blocked',
          fallback_used: false
        };
      }
      writeJson(store, 'v2/failure-state.json', failureState);
      const projectedState = projectAppliedFailureState(
        state,
        failureState,
        failure.id
      );
      if (!projectedState.ok) {
        return {
          ...projectedState,
          fallback_used: false
        };
      }
      writeJson(
        store,
        relativeRepairPath(failure.id, 'repair-state.json'),
        projectedState
      );
      return {
        ok: true,
        status: 'transition_applied',
        failure_id: failure.id,
        action: applied.receipt.action,
        receipt_id: applied.receipt.id,
        replayed: applied.status === 'already_applied',
        open_failure_ids: failureState.open_failure_ids,
        blockers: [],
        fallback_used: false
      };
    }

    const failureState = reduceFailureState(
      context,
      root,
      failure,
      authority,
      authorityLog
    );
    const projectedState = projectAppliedFailureState(
      state,
      failureState,
      failure.id
    );
    if (!projectedState.ok) {
      return {
        ...projectedState,
        fallback_used: false
      };
    }
    writeJson(
      store,
      relativeRepairPath(failure.id, 'repair-state.json'),
      projectedState
    );
    return {
      ...projectedState,
      failure_id: failure.id,
      fallback_used: false
    };
  } catch (error) {
    return {
      ok: false,
      status: 'blocked',
      blockers: Array.isArray(error.blockers)
        ? error.blockers
        : [blocker(
            error instanceof Error ? error.message : String(error),
            failureId
          )],
      fallback_used: false
    };
  }
}

async function main() {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify(blocked(
      'verification-repair:unhandled',
      'verification-v2-repair-loop',
      error instanceof Error ? error.message : String(error)
    ), null, 2)}\n`);
    process.exit(2);
  });
}

module.exports = {
  attemptFact,
  attemptFingerprint,
  evaluateState,
  fingerprintDrift,
  projectAppliedFailureState,
  reduceFailureState,
  repairLineageDrift,
  run,
  scopeProjection,
  trustAuthority,
  validateRepairDiff,
  validateRepairRebindScope,
  repairCompletionFingerprints
};
