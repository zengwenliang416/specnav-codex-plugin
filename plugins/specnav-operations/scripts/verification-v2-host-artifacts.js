#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const safeFs = require('./safe-filesystem');
const {
  requireTrustedCore,
  trustedVerificationRoot
} = require('./verification-v2-trusted-runtime');
const {
  validateHostProofPointerChain
} = require('./verification-v2-pointer-chain');
const {
  HOST_DESCRIPTORS,
  REQUIRED_HOSTS,
  hostProofRunnerSourceDigest,
  hostProbeCommands,
  managedFixtureManifestDigest,
  officialHostLockValid
} = require('./verification-v2-host-contract');

const LOCAL_REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const LOCAL_VERIFICATION_ROOT = trustedVerificationRoot(
  LOCAL_REPOSITORY_ROOT
);
const kernel = require(path.join(LOCAL_VERIFICATION_ROOT, 'kernel'));
const {
  createTrustedFactAuthority
} = require(path.join(LOCAL_VERIFICATION_ROOT, 'kernel', 'repair'));
const core = requireTrustedCore(LOCAL_REPOSITORY_ROOT);

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function blocker(id, artifact = null, detail = null) {
  return { id, artifact, detail };
}

function blocked(id, artifact = null, detail = null, artifacts = []) {
  return {
    ok: false,
    status: 'blocked',
    blockers: [blocker(id, artifact, detail)],
    artifacts,
    fallback_used: false
  };
}

function realDirectory(value, id) {
  try {
    const resolved = fs.realpathSync(path.resolve(value));
    if (!fs.statSync(resolved).isDirectory()) throw new Error('not-directory');
    return resolved;
  } catch (error) {
    const failure = new Error(id);
    failure.blockers = [blocker(
      id,
      value,
      error instanceof Error ? error.message : String(error)
    )];
    throw failure;
  }
}

function readSafeJson(root, file, id) {
  try {
    const bytes = safeFs.readRegularFile(root, file, id);
    return {
      bytes,
      value: JSON.parse(bytes.toString('utf8'))
    };
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

function readOptionalSafeFile(root, file, id) {
  try {
    return safeFs.readRegularFile(root, file, id, true);
  } catch (error) {
    if (String(error?.message || '').endsWith(':missing')) return null;
    throw error;
  }
}

function sameOptionalBytes(left, right) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function stalePointerError(detail = null) {
  const error = new Error('verification-host-artifacts:stale-pointer');
  error.blockers = [blocker(
    'verification-host-artifacts:stale-pointer',
    'operations/host-proof-current.json',
    detail
  )];
  return error;
}

function immutableWrite(changeDir, relative, bytes) {
  const target = path.join(changeDir, relative);
  const blockerId = `verification-host-artifacts:${relative}`;
  try {
    safeFs.atomicWriteFile(changeDir, target, bytes, blockerId, true);
    return;
  } catch (error) {
    if (!String(error?.message || '').endsWith(':exists')) throw error;
  }
  const existing = safeFs.readRegularFile(
    changeDir,
    target,
    blockerId
  );
  if (!existing.equals(bytes)) {
    throw new Error(`verification-host-artifacts:immutable-conflict:${relative}`);
  }
}

function immutableJson(changeDir, relative, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  immutableWrite(changeDir, relative, bytes);
  return {
    path: relative,
    sha256: sha256(bytes)
  };
}

function loadPointerStart(context) {
  const relative = 'operations/host-proof-current.json';
  const file = path.join(context.changeDir, relative);
  const bytes = readOptionalSafeFile(
    context.changeDir,
    file,
    'verification-host-artifacts:current-pointer-read'
  );
  if (bytes === null) {
    return {
      bytes: null,
      digest: null,
      generation: 0,
      value: null
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const failure = new Error(
      'verification-host-artifacts:current-pointer-invalid'
    );
    failure.blockers = [blocker(
      failure.message,
      relative,
      error instanceof Error ? error.message : String(error)
    )];
    throw failure;
  }
  const value = validateWith(
    context.schemaRegistry,
    'host-proof-pointer',
    parsed,
    relative
  );
  if (value.change_id !== context.changeId) {
    throw stalePointerError({
      expected_change_id: context.changeId,
      actual_change_id: value.change_id
    });
  }
  validateHostProofPointerChain({
    changeId: context.changeId,
    pointer: value,
    pointerPath: relative,
    readPointer(pointerPath) {
      return readSafeJson(
        context.changeDir,
        path.join(context.changeDir, pointerPath),
        'verification-host-artifacts:pointer-history-invalid'
      );
    },
    sha256,
    validatePointer(candidate, artifact) {
      return validateWith(
        context.schemaRegistry,
        'host-proof-pointer',
        candidate,
        artifact
      );
    }
  });
  return {
    bytes,
    digest: sha256(bytes),
    generation: value.generation,
    value
  };
}

function assertPublishInputsCurrent(context, lockFile, hostLockSha) {
  const runtimeStatusRead = readSafeJson(
    context.projectRoot,
    path.join(context.changeDir, 'verify', 'v2', 'runtime-status.json'),
    'verification-host-artifacts:publish-runtime-status-invalid'
  );
  const runtimeResolution = kernel.createRuntimeAuthority({
    projectRoot: context.projectRoot
  }).resolve(
    runtimeStatusRead.value
  );
  const gateInputRead = readSafeJson(
    context.projectRoot,
    path.join(context.changeDir, 'verify', 'v2', 'gate-input.json'),
    'verification-host-artifacts:publish-gate-input-invalid'
  );
  const releaseGateRead = readSafeJson(
    context.projectRoot,
    path.join(context.changeDir, 'verify', 'v2', 'release-gate.json'),
    'verification-host-artifacts:publish-release-gate-invalid'
  );
  const archiveGateRead = readSafeJson(
    context.projectRoot,
    path.join(context.changeDir, 'verify', 'v2', 'archive-gate.json'),
    'verification-host-artifacts:publish-archive-gate-invalid'
  );
  const evidenceIndexRead = readSafeJson(
    context.projectRoot,
    path.join(context.changeDir, 'verify', 'evidence', 'index.json'),
    'verification-host-artifacts:publish-evidence-index-invalid'
  );
  let currentLockFile;
  let currentLockBytes;
  try {
    currentLockFile = fs.realpathSync(lockFile);
    currentLockBytes = fs.readFileSync(currentLockFile);
  } catch (error) {
    const failure = new Error(
      'verification-host-artifacts:publish-host-lock-invalid'
    );
    failure.blockers = [blocker(
      failure.message,
      lockFile,
      error instanceof Error ? error.message : String(error)
    )];
    throw failure;
  }
  const mismatches = [];
  if (
    !runtimeResolution.ok
    || runtimeResolution.authority?.digest
      !== context.runtimeResolution.authority.digest
  ) {
    mismatches.push('runtime-authority');
  }
  if (sha256(gateInputRead.bytes) !== context.bindings.gate_input_sha256) {
    mismatches.push('gate-input');
  }
  if (
    releaseGateRead.value.id !== context.bindings.release_gate_id
    || releaseGateRead.value.decision !== 'pass'
  ) {
    mismatches.push('release-gate');
  }
  if (
    archiveGateRead.value.id !== context.bindings.archive_gate_id
    || archiveGateRead.value.decision !== 'pass'
  ) {
    mismatches.push('archive-gate');
  }
  if (
    evidenceIndexRead.value.source_digest
      !== context.bindings.evidence_index_digest
  ) {
    mismatches.push('evidence-index');
  }
  if (
    currentLockFile !== lockFile
    || sha256(currentLockBytes) !== hostLockSha
  ) {
    mismatches.push('host-lock');
  }
  if (mismatches.length > 0) {
    const error = new Error(
      'verification-host-artifacts:publish-input-changed'
    );
    error.blockers = [blocker(
      error.message,
      null,
      mismatches
    )];
    throw error;
  }
}

function validateWith(schemaRegistry, entityType, value, artifact) {
  const result = schemaRegistry.validate(entityType, value, {
    artifactPath: artifact
  });
  if (!result.ok) {
    const error = new Error(
      `verification-host-artifacts:schema-invalid:${entityType}`
    );
    error.blockers = result.blockers;
    throw error;
  }
  return result.value;
}

function loadContext(request) {
  const projectRoot = realDirectory(
    request.projectRoot,
    'verification-host-artifacts:project-root-invalid'
  );
  const state = core.activeChangeState(
    projectRoot,
    request.changeId ? { change: request.changeId } : {}
  );
  if (!state.change) {
    const error = new Error('verification-host-artifacts:change-invalid');
    error.blockers = (state.blockers || []).map((id) => blocker(id));
    throw error;
  }
  const changeId = state.change;
  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeId);
  const verifyV2 = path.join(changeDir, 'verify', 'v2');
  const runtimeStatusRead = readSafeJson(
    projectRoot,
    path.join(verifyV2, 'runtime-status.json'),
    'verification-host-artifacts:runtime-status-invalid'
  );
  const runtimeResolution = kernel.createRuntimeAuthority({
    projectRoot
  }).resolve(
    runtimeStatusRead.value
  );
  if (!runtimeResolution.ok) {
    const error = new Error('verification-host-artifacts:runtime-authority-blocked');
    error.blockers = runtimeResolution.blockers;
    throw error;
  }
  const schemaRegistry = kernel.createSchemaRegistry({
    runtimeStatus: runtimeResolution.runtimeStatus,
    runtimeRoot: runtimeResolution.runtimeRoot
  });
  const gateInputRead = readSafeJson(
    projectRoot,
    path.join(verifyV2, 'gate-input.json'),
    'verification-host-artifacts:gate-input-invalid'
  );
  const releaseGateRead = readSafeJson(
    projectRoot,
    path.join(verifyV2, 'release-gate.json'),
    'verification-host-artifacts:release-gate-invalid'
  );
  const archiveGateRead = readSafeJson(
    projectRoot,
    path.join(verifyV2, 'archive-gate.json'),
    'verification-host-artifacts:archive-gate-invalid'
  );
  const evidenceIndexRead = readSafeJson(
    projectRoot,
    path.join(changeDir, 'verify', 'evidence', 'index.json'),
    'verification-host-artifacts:evidence-index-invalid'
  );
  const gateInput = gateInputRead.value;
  const releaseGate = releaseGateRead.value;
  const archiveGate = archiveGateRead.value;
  const evidenceIndex = evidenceIndexRead.value;
  if (
    gateInput.change_id !== changeId
    || releaseGate.change_id !== changeId
    || archiveGate.change_id !== changeId
    || releaseGate.decision !== 'pass'
    || archiveGate.decision !== 'pass'
    || !/^[a-f0-9]{64}$/.test(evidenceIndex.source_digest || '')
  ) {
    throw new Error('verification-host-artifacts:verification-not-green');
  }
  return {
    projectRoot,
    changeId,
    changeDir,
    gateInput,
    schemaRegistry,
    runtimeResolution,
    bindings: {
      change_id: changeId,
      release_gate_id: releaseGate.id,
      archive_gate_id: archiveGate.id,
      gate_input_sha256: sha256(gateInputRead.bytes),
      evidence_index_digest: evidenceIndex.source_digest
    }
  };
}

function projectSourceInventory(projectRoot) {
  const git = '/usr/bin/git';
  const env = {
    HOME: projectRoot,
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0'
  };
  const status = spawnSync(git, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ], {
    cwd: projectRoot,
    env,
    encoding: 'utf8'
  });
  if (status.status !== 0 || status.stdout.trim() !== '') {
    throw new Error('verification-host-artifacts:source-worktree-not-clean');
  }
  const tree = spawnSync(git, ['ls-tree', '-r', 'HEAD'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (tree.status !== 0) {
    throw new Error('verification-host-artifacts:source-inventory-unavailable');
  }
  return kernel.codeInventorySha(tree.stdout);
}

function commandSucceeded(command) {
  return command.exit_status === 0
    && command.signal === null
    && !command.error;
}

function commandBlocker(host, command) {
  return blocker(
    `verification-host-artifacts:host-command-failed:${host}:${command.id}`,
    command.argv.join(' '),
    command.error || command.signal || command.exit_status
  );
}

function createHostArtifactGenerator(options = {}) {
  const clock = options.clock || (() => new Date().toISOString());
  const nonce = options.nonce || (() => crypto.randomBytes(32).toString('hex'));
  const authorityFactory = options.authorityFactory
    || kernel.createHostCompatibilityAuthority;
  const launcherFactory = options.launcherFactory
    || ((launcherOptions) => kernel.createHostProofLauncher({
      ...launcherOptions,
      hosts: REQUIRED_HOSTS,
      sourceHost: 'codex',
      dependencyHosts: ['codefree-o', 'dsh'],
      rootEnvironment(roots) {
        return {
          SPECNAV_CODEX_ROOT: roots.codex,
          SPECNAV_CLAUDE_ROOT: roots['claude-code'],
          SPECNAV_CODEFREE_O_ROOT: roots['codefree-o'],
          SPECNAV_DSH_ROOT: roots['dsh']
        };
      }
    }));
  const sourceInventoryResolver = options.sourceInventoryResolver
    || projectSourceInventory;
  const configuredFixtureRoot = options.managedFixtureRoot || null;
  const runnerSourceResolver = options.runnerSourceResolver || (() => {
    const local = hostProofRunnerSourceDigest(LOCAL_REPOSITORY_ROOT);
    return {
      local,
      locked: null
    };
  });

  function generate(request) {
    let prepared = null;
    let launcher = null;
    const publishedArtifacts = [];
    try {
      const context = loadContext(request);
      const pointerStart = loadPointerStart(context);
      const lockFile = fs.realpathSync(path.resolve(request.lockFile));
      const lockBytes = fs.readFileSync(lockFile);
      const lock = validateWith(
        context.schemaRegistry,
        'cross-host-lock',
        JSON.parse(lockBytes.toString('utf8')),
        lockFile
      );
      if (!officialHostLockValid(lock)) {
        throw new Error('verification-host-artifacts:host-lock-policy-invalid');
      }
      const hostLockSha = sha256(lockBytes);
      launcher = launcherFactory({ clock });
      prepared = launcher.prepare(lock);
      if (!prepared.ok) {
        return {
          ok: false,
          status: 'blocked',
          blockers: prepared.blockers,
          artifacts: [],
          fallback_used: false
        };
      }
      const lockedVerificationRoot = realDirectory(
        path.join(prepared.roots.codex, lock.source.plugin_path),
        'verification-host-artifacts:locked-verification-root-invalid'
      );
      const fixtureRoot = realDirectory(
        configuredFixtureRoot || path.join(
          lockedVerificationRoot,
          'assets',
          'contract-fixtures'
        ),
        'verification-host-artifacts:fixture-root-invalid'
      );
      const managedRuntimeProbe = path.join(
        prepared.roots.codex,
        lock.source.plugin_path,
        'scripts',
        'verification-runtime.js'
      );
      const runnerSources = runnerSourceResolver({
        localRepositoryRoot: LOCAL_REPOSITORY_ROOT,
        lockedRepositoryRoot: prepared.roots.codex
      });
      const localRunnerSourceSha = runnerSources?.local
        || hostProofRunnerSourceDigest(LOCAL_REPOSITORY_ROOT);
      const lockedRunnerSourceSha = runnerSources?.locked
        || hostProofRunnerSourceDigest(prepared.roots.codex);
      if (localRunnerSourceSha !== lockedRunnerSourceSha) {
        return blocked(
          'verification-host-artifacts:runner-source-mismatch',
          lockFile,
          {
            local: localRunnerSourceSha,
            locked: lockedRunnerSourceSha
          },
          publishedArtifacts
        );
      }
      const runnerIdentitySha = kernel.createHostRunnerIdentity(
        lockedRunnerSourceSha,
        prepared.toolchain
      );
      const fixtureManifestSha = managedFixtureManifestDigest(fixtureRoot);
      const authorityOptions = {
        lockFile,
        fixtureRoot,
        descriptors: HOST_DESCRIPTORS,
        sourceHost: 'codex',
        roots: prepared.roots
      };
      const beforeAuthority = authorityFactory(authorityOptions).resolve();
      if (!beforeAuthority.ok) {
        return {
          ok: false,
          status: 'blocked',
          blockers: beforeAuthority.blockers,
          artifacts: [],
          fallback_used: false
        };
      }
      const trust = createTrustedFactAuthority({
        schemaRegistry: context.schemaRegistry,
        key: context.runtimeResolution.signingKey,
        clock
      });
      const runId = `host-proof-${sha256(canonicalJson({
        change_id: context.changeId,
        host_lock_sha256: hostLockSha,
        bindings: context.bindings,
        runtime_authority_digest: context.runtimeResolution.authority.digest,
        nonce: nonce()
      }))}`;
      const runRoot = `operations/host-proof-runs/${runId}`;
      const lockArtifact = {
        path: `${runRoot}/cross-host-lock.json`,
        sha256: hostLockSha
      };
      immutableWrite(context.changeDir, lockArtifact.path, lockBytes);
      publishedArtifacts.push(lockArtifact.path);
      const environmentSha = launcher.environmentDigest(
        prepared,
        context.runtimeResolution.authority,
        runnerIdentitySha
      );
      const expectedSourceInventory = sourceInventoryResolver(
        context.projectRoot
      );
      if (
        !/^[a-f0-9]{40,64}$/.test(expectedSourceInventory || '')
        || prepared.observations?.codex?.source_code_inventory_sha
          !== expectedSourceInventory
      ) {
        return blocked(
          'verification-host-artifacts:source-inventory-mismatch',
          lockFile,
          {
            expected: expectedSourceInventory || null,
            actual: prepared.observations?.codex?.source_code_inventory_sha
              || null
          },
          publishedArtifacts
        );
      }
      const hostFacts = [];
      for (const host of REQUIRED_HOSTS) {
        const locked = host === 'codex' ? lock.source : lock.hosts[host];
        const probes = hostProbeCommands(
          host,
          prepared.roots[host],
          path.join(prepared.roots[host], locked.plugin_path),
          prepared.toolchain,
          {
            managedRuntimeProbe,
            runtimeBase: path.dirname(context.runtimeResolution.runtimeRoot),
            runtimeVersion: context.runtimeResolution.runtimeStatus.runtime_version
          }
        );
        const probeIds = [
          ...(['codefree-o', 'dsh'].includes(host) ? ['dependency-install'] : []),
          'runtime-doctor',
          'host-smoke'
        ];
        const commands = [...prepared.setup[host]];
        for (const [index, argv] of probes.entries()) {
          const result = launcher.run(host, argv, {
            id: probeIds[index],
            workspace: prepared.workspace,
            roots: prepared.roots,
            runtimeRoot: context.runtimeResolution.runtimeRoot,
            trustedRoots: [],
            allowRuntime: probeIds[index] === 'runtime-doctor',
            allowCheckoutWrite: probeIds[index] === 'dependency-install',
            allowNetwork: probeIds[index] === 'dependency-install',
            timeoutMs: 1800000
          });
          commands.push(result);
          if (!commandSucceeded(result)) break;
        }
        const commandRecords = commands.map((command, index) => {
          const stdoutPath = `${runRoot}/${host}-${index + 1}.stdout.log`;
          const stderrPath = `${runRoot}/${host}-${index + 1}.stderr.log`;
          immutableWrite(context.changeDir, stdoutPath, command.stdout);
          immutableWrite(context.changeDir, stderrPath, command.stderr);
          publishedArtifacts.push(stdoutPath, stderrPath);
          return {
            id: command.id,
            argv: command.argv,
            executable_realpath: command.executable_realpath,
            executable_sha256: command.executable_sha256,
            sandbox_executable_realpath:
              command.sandbox_executable_realpath || null,
            sandbox_executable_sha256:
              command.sandbox_executable_sha256 || null,
            sandbox_policy_sha256: command.sandbox_policy_sha256 || null,
            sandbox_argv: command.sandbox_argv || null,
            exit_status: command.exit_status,
            signal: command.signal,
            stdout_sha256: sha256(command.stdout),
            stderr_sha256: sha256(command.stderr),
            stdout_path: stdoutPath,
            stderr_path: stderrPath,
            started_at: command.started_at,
            completed_at: command.completed_at
          };
        });
        const failedCommand = commands.find((command) => !commandSucceeded(command));
        const execution = validateWith(
          context.schemaRegistry,
          'host-execution',
          {
            schema: 'specnav.verification.host-execution.v1',
            change_id: context.changeId,
            run_id: runId,
            host,
            status: failedCommand ? 'failed' : 'passed',
            repository: locked.repository,
            ref: locked.ref,
            commit: locked.commit,
            host_lock_sha256: hostLockSha,
            ...context.bindings,
            runtime_authority_digest: context.runtimeResolution.authority.digest,
            host_authority_digest: beforeAuthority.summary.digest,
            source_snapshot_digest: beforeAuthority.summary.snapshots[host],
            runner_identity_sha256: runnerIdentitySha,
            runner_source_sha256: lockedRunnerSourceSha,
            environment_sha256: environmentSha,
            fixture_snapshot_digest:
              beforeAuthority.snapshots[host].fixtures.digest,
            fixture_manifest_sha256: fixtureManifestSha,
            observations: prepared.observations[host],
            commands: commandRecords,
            blocker: failedCommand
              ? commandBlocker(host, failedCommand)
              : null,
            started_at: commandRecords[0].started_at,
            completed_at: commandRecords.at(-1).completed_at
          },
          `${runRoot}/${host}.execution.json`
        );
        const envelope = trust.seal('host_execution', execution, {
          failure_id: runId,
          change_id: context.changeId,
          run_id: runId,
          case_id: host
        });
        const envelopeArtifact = immutableJson(
          context.changeDir,
          `${runRoot}/${host}.execution-envelope.json`,
          envelope
        );
        publishedArtifacts.push(envelopeArtifact.path);
        hostFacts.push({
          host,
          locked,
          execution,
          envelope,
          envelopeArtifact
        });
      }
      const failedFact = hostFacts.find(
        ({ execution }) => execution.status !== 'passed'
      );
      if (failedFact) {
        return blocked(
          failedFact.execution.blocker.id,
          failedFact.execution.blocker.artifact,
          failedFact.execution.blocker.detail,
          publishedArtifacts
        );
      }
      const afterAuthority = authorityFactory(authorityOptions).resolve();
      if (
        !afterAuthority.ok
        || afterAuthority.summary.digest !== beforeAuthority.summary.digest
      ) {
        return blocked(
          'verification-host-artifacts:host-source-mutated-during-run',
          lockFile,
          {
            before: beforeAuthority.summary.digest,
            after: afterAuthority.summary?.digest || null,
            blockers: afterAuthority.blockers || []
          },
          publishedArtifacts
        );
      }
      const indexHosts = [];
      for (const fact of hostFacts) {
        const commandProjection = fact.execution.commands.map((command) => ({
          argv: command.argv,
          exit_status: command.exit_status,
          stdout_sha256: command.stdout_sha256,
          stderr_sha256: command.stderr_sha256,
          stdout_path: command.stdout_path,
          stderr_path: command.stderr_path
        }));
        const receipt = validateWith(
          context.schemaRegistry,
          'host-install-receipt',
          {
            schema: 'specnav.verification.host-install-receipt.v1',
            host: fact.host,
            ...context.bindings,
            host_lock_sha256: hostLockSha,
            runtime_authority_digest: context.runtimeResolution.authority.digest,
            runner_identity_sha256: runnerIdentitySha,
            runner_source_sha256: lockedRunnerSourceSha,
            source_snapshot_digest: beforeAuthority.summary.snapshots[fact.host],
            fixture_snapshot_digest:
              beforeAuthority.snapshots[fact.host].fixtures.digest,
            fixture_manifest_sha256: fixtureManifestSha,
            repository: fact.locked.repository,
            ref: fact.locked.ref,
            commit: fact.locked.commit,
            remote_commit_reachable: true,
            checkout_realpath: prepared.roots[fact.host],
            plugin_realpath: path.join(
              prepared.roots[fact.host],
              fact.locked.plugin_path
            ),
            clean_checkout: true,
            plugin_discovered: true,
            runtime_ready: true,
            checks: [
              {
                id: 'plugin-discovery',
                status: 'pass',
                evidence: 'The locked plugin path was verified without symlinks.'
              },
              {
                id: 'remote-commit-reachability',
                status: 'pass',
                evidence: 'The advertised ref resolved to the locked commit.'
              },
              {
                id: 'runtime-doctor',
                status: 'pass',
                evidence: 'The managed Verification runtime doctor passed.'
              },
              {
                id: 'host-smoke',
                status: 'pass',
                evidence: 'The committed host smoke command passed in the sandbox.'
              }
            ],
            execution: {
              commands: commandProjection,
              environment_sha256: environmentSha,
              started_at: fact.execution.started_at,
              completed_at: fact.execution.completed_at
            },
            execution_envelope_path: fact.envelopeArtifact.path,
            execution_envelope_sha256: fact.envelopeArtifact.sha256,
            attestation: 'system-executed',
            fallback_used: false,
            recorded_at: clock()
          },
          `${runRoot}/${fact.host}.receipt.json`
        );
        const receiptArtifact = immutableJson(
          context.changeDir,
          `${runRoot}/${fact.host}.receipt.json`,
          receipt
        );
        publishedArtifacts.push(receiptArtifact.path);
        indexHosts.push({
          host: fact.host,
          receipt_path: receiptArtifact.path,
          receipt_sha256: receiptArtifact.sha256,
          commit: fact.locked.commit
        });
      }
      const index = validateWith(
        context.schemaRegistry,
        'host-installation-index',
        {
          schema: 'specnav.verification.host-installation-index.v1',
          change_id: context.changeId,
          host_lock_sha256: hostLockSha,
          hosts: indexHosts,
          fallback_used: false
        },
        `${runRoot}/host-installation-index.json`
      );
      const compatibility = validateWith(
        context.schemaRegistry,
        'cross-host-release-result',
        {
          schema: 'specnav.verification.cross-host-release-result.v1',
          ...context.bindings,
          host_lock_sha256: hostLockSha,
          authority_digest: beforeAuthority.summary.digest,
          comparison_digest: beforeAuthority.summary.comparison,
          ok: true,
          hosts: indexHosts.map((entry) => ({
            host: entry.host,
            commit: entry.commit,
            snapshot_digest: beforeAuthority.summary.snapshots[entry.host],
            receipt_sha256: entry.receipt_sha256
          })),
          kernel_version: context.gateInput.kernel_version,
          blockers: [],
          fallback_used: false,
          recorded_at: clock()
        },
        `${runRoot}/cross-host-compatibility.json`
      );
      const indexArtifact = immutableJson(
        context.changeDir,
        `${runRoot}/host-installation-index.json`,
        index
      );
      const compatibilityArtifact = immutableJson(
        context.changeDir,
        `${runRoot}/cross-host-compatibility.json`,
        compatibility
      );
      publishedArtifacts.push(indexArtifact.path, compatibilityArtifact.path);
      const pointer = validateWith(
        context.schemaRegistry,
        'host-proof-pointer',
        {
          schema: 'specnav.verification.host-proof-pointer.v1',
          change_id: context.changeId,
          run_id: runId,
          host_lock_sha256: hostLockSha,
          runtime_authority_digest: context.runtimeResolution.authority.digest,
          generation: pointerStart.generation + 1,
          previous_pointer: pointerStart.value === null
            ? null
            : {
                path: `operations/host-proof-runs/${
                  pointerStart.value.run_id
                }/host-proof-pointer.json`,
                sha256: pointerStart.digest
              },
          lock: lockArtifact,
          index: indexArtifact,
          compatibility: compatibilityArtifact,
          published_at: clock(),
          fallback_used: false
        },
        'operations/host-proof-current.json'
      );
      const pointerArtifact = immutableJson(
        context.changeDir,
        `${runRoot}/host-proof-pointer.json`,
        pointer
      );
      publishedArtifacts.push(pointerArtifact.path);
      const lockRelative = 'operations/.host-proof-publish.lock';
      safeFs.createLock(
        context.changeDir,
        lockRelative,
        runId,
        'verification-host-artifacts:publish-lock'
      );
      try {
        const currentPointer = readOptionalSafeFile(
          context.changeDir,
          path.join(context.changeDir, 'operations', 'host-proof-current.json'),
          'verification-host-artifacts:current-pointer-reread'
        );
        if (!sameOptionalBytes(currentPointer, pointerStart.bytes)) {
          throw stalePointerError({
            expected_sha256: pointerStart.digest,
            actual_sha256: currentPointer === null
              ? null
              : sha256(currentPointer)
          });
        }
        assertPublishInputsCurrent(context, lockFile, hostLockSha);
        try {
          safeFs.atomicCompareAndSwapJson(
            context.changeDir,
            path.join(
              context.changeDir,
              'operations',
              'host-proof-current.json'
            ),
            pointer,
            pointerStart.bytes,
            'verification-host-artifacts:current-pointer-cas'
          );
        } catch (error) {
          if (
            String(error?.message || '')
              .endsWith(':changed-during-write')
          ) {
            throw stalePointerError();
          }
          throw error;
        }
      } finally {
        safeFs.releaseLock(
          context.changeDir,
          lockRelative,
          runId,
          'verification-host-artifacts:publish-unlock'
        );
      }
      return {
        ok: true,
        status: 'generated',
        change_id: context.changeId,
        run_id: runId,
        hosts: indexHosts,
        artifacts: [
          'operations/host-proof-current.json',
          ...publishedArtifacts
        ],
        blockers: [],
        fallback_used: false
      };
    } catch (error) {
      return {
        ok: false,
        status: 'blocked',
        blockers: Array.isArray(error.blockers)
          ? error.blockers
          : [blocker(
              error instanceof Error ? error.message : String(error)
            )],
        artifacts: publishedArtifacts,
        fallback_used: false
      };
    } finally {
      if (launcher && prepared) launcher.cleanup(prepared);
    }
  }

  return Object.freeze({ generate });
}

function main() {
  const args = process.argv.slice(2);
  const action = args.find((entry) => !entry.startsWith('--')) || 'generate';
  if (action !== 'generate') {
    const result = blocked(
      `verification-host-artifacts:unsupported-action:${action}`,
      action
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(2);
  }
  const projectRoot = argValue(args, '--project', process.cwd());
  const result = createHostArtifactGenerator().generate({
    projectRoot,
    changeId: argValue(args, '--change'),
    lockFile: argValue(
      args,
      '--host-lock',
      path.join(
        projectRoot,
        'integrations',
        'verification-v2',
        'cross-host-lock.json'
      )
    )
  });
  process.stdout.write(
    args.includes('--json')
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${result.ok ? 'generated' : 'blocked'}\n`
  );
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  createHostArtifactGenerator
};
