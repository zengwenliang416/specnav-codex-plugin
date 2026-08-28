'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kernel = require('../../../plugins/specnav-verification/kernel');
const {
  createHostArtifactGenerator
} = require('../../../plugins/specnav-operations/scripts/verification-v2-host-artifacts');
const {
  createReleaseProofValidator
} = require('../../../plugins/specnav-operations/scripts/verification-v2-proof');
const {
  createHostAuthorityFixture
} = require('../cross-host/host-authority-test-helpers');
const {
  populateProject
} = require('./populate-project');
const {
  hostProofRunnerSourceDigest,
  hostProofRunnerSourceFiles,
  managedFixtureManifestDigest
} = require('../../../plugins/specnav-operations/scripts/verification-v2-host-contract');

const CHANGE = 'host-artifacts-change';
const ROOT = path.resolve(__dirname, '../../..');
const RUNNER_SOURCE_SHA256 = hostProofRunnerSourceDigest(ROOT);

function runnerSourceFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-runner-source-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = hostProofRunnerSourceFiles(ROOT);
  for (const relative of files) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relative), target);
  }
  return { files, root };
}

function prepareProject(t) {
  const hosts = createHostAuthorityFixture(t);
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-host-artifacts-')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'openspec', '.specnav'), {
    recursive: true
  });
  fs.writeFileSync(
    path.join(root, 'openspec', '.specnav', 'active-change'),
    `${CHANGE}\n`
  );
  populateProject(root, CHANGE, {
    fixtureRoot: hosts.fixtureRoot,
    hostLockFile: hosts.lockFile,
    hostRoots: hosts.roots
  });
  const inventory = spawnSync('/usr/bin/git', ['ls-tree', '-r', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(inventory.status, 0, inventory.stderr);
  const sourceTreeInventory = inventory.stdout;
  const sourceCodeSha = kernel.codeInventorySha(sourceTreeInventory);
  const operations = path.join(
    root,
    'openspec',
    'changes',
    CHANGE,
    'operations'
  );
  fs.rmSync(operations, { recursive: true, force: true });
  fs.mkdirSync(operations, { recursive: true });
  return {
    hosts,
    operations,
    root,
    sourceCodeSha,
    sourceTreeInventory
  };
}

function executable(file) {
  const real = fs.realpathSync(file);
  return {
    path: real,
    sha256: require('node:crypto')
      .createHash('sha256')
      .update(fs.readFileSync(real))
      .digest('hex')
  };
}

function testToolchain() {
  return {
    node: executable(process.execPath),
    git: executable('/usr/bin/git'),
    bash: executable('/bin/bash'),
    npm: executable(path.resolve(
      path.dirname(process.execPath),
      '../lib/node_modules/npm/bin/npm-cli.js'
    )),
    sandbox: executable('/usr/bin/sandbox-exec')
  };
}

function execution(
  id,
  argv,
  sequence = 0,
  exitStatus = 0,
  stdoutValue = null,
  sandbox = null
) {
  const startedAt = new Date(
    Date.parse('2026-08-09T12:00:00.000Z') + sequence * 1000
  ).toISOString();
  const completedAt = new Date(
    Date.parse(startedAt) + 500
  ).toISOString();
  return {
    id,
    argv,
    executable_realpath: fs.realpathSync(argv[0]),
    executable_sha256: require('node:crypto')
      .createHash('sha256')
      .update(fs.readFileSync(fs.realpathSync(argv[0])))
      .digest('hex'),
    sandbox_executable_realpath: sandbox?.executable.path || null,
    sandbox_executable_sha256: sandbox?.executable.sha256 || null,
    sandbox_policy_sha256: sandbox?.policy_sha256 || null,
    sandbox_argv: sandbox?.argv || null,
    started_at: startedAt,
    completed_at: completedAt,
    exit_status: exitStatus,
    signal: null,
    stdout: Buffer.from(stdoutValue ?? `ok ${argv.join(' ')}\n`),
    stderr: exitStatus === 0
      ? Buffer.alloc(0)
      : Buffer.from('command failed\n'),
    error: null
  };
}

function launcherFixture(fixture, failure = null, onRun = null) {
  const tools = testToolchain();
  let sequence = 0;
  const lock = fixture.hosts.readLock();
  const setup = Object.fromEntries(
    ['claude-code', 'codex', 'codefree-o', 'dsh'].map((host) => {
      const locked = host === 'codex' ? lock.source : lock.hosts[host];
      const commands = [
        execution('remote-ref', [
          tools.git.path,
          'ls-remote',
          '--refs',
          locked.repository,
          locked.ref
        ], sequence++, 0, `${locked.commit}\t${locked.ref}\n`),
        execution('checkout-init', [
          tools.git.path,
          '-c',
          'core.hooksPath=/dev/null',
          'init',
          '--quiet'
        ], sequence++),
        execution('checkout-remote', [
          tools.git.path,
          '-c',
          'core.hooksPath=/dev/null',
          'remote',
          'add',
          'origin',
          locked.repository
        ], sequence++),
        execution('checkout-fetch', [
          tools.git.path,
          '-c',
          'core.hooksPath=/dev/null',
          'fetch',
          '--quiet',
          '--depth=1',
          'origin',
          locked.ref
        ], sequence++),
        execution('checkout-detach', [
          tools.git.path,
          '-c',
          'core.hooksPath=/dev/null',
          'checkout',
          '--quiet',
          '--detach',
          locked.commit
        ], sequence++),
        execution('checkout-head', [
          tools.git.path,
          'rev-parse',
          'HEAD^{commit}'
        ], sequence++, 0, `${locked.commit}\n`)
      ];
      if (host === 'codex') {
        commands.push(execution('checkout-tree', [
          tools.git.path,
          'ls-tree',
          '-r',
          'HEAD'
        ], sequence++, 0, fixture.sourceTreeInventory));
      }
      return [host, commands];
    })
  );
  return () => ({
    prepare() {
      if (failure === 'remote') {
        return {
          ok: false,
          blockers: [{
            id: 'verification-host-launcher:remote-ref-unreachable:codex',
            artifact: null,
            detail: null
          }]
        };
      }
      return {
        ok: true,
        workspace: path.dirname(fixture.hosts.roots.codex),
        roots: fixture.hosts.roots,
        setup,
        observations: Object.fromEntries(
          ['claude-code', 'codex', 'codefree-o', 'dsh'].map((host) => {
            const locked = host === 'codex'
              ? lock.source
              : lock.hosts[host];
            return [host, {
              advertised_commit: locked.commit,
              checkout_head: locked.commit,
              source_code_inventory_sha: host === 'codex'
                ? fixture.sourceCodeSha
                : null,
              package_lock_sha256: ['codefree-o', 'dsh'].includes(host)
                ? '8'.repeat(64)
                : null
            }];
          })
        ),
        runner_identity_sha256: kernel.createHostRunnerIdentity(
          RUNNER_SOURCE_SHA256,
          tools
        ),
        runner_source_sha256: RUNNER_SOURCE_SHA256,
        toolchain: tools,
        blockers: []
      };
    },
    run(host, argv, context) {
      if (onRun) {
        const callback = onRun;
        onRun = null;
        callback();
      }
      const writable = path.join(context.workspace, '.runtime', host);
      const sandbox = kernel.createHostSandboxPlan({
        toolchain: tools,
        allowedRoots: [
          ...Object.values(context.roots),
          ...(context.allowRuntime === true ? [context.runtimeRoot] : []),
          ...(context.trustedRoots || []),
          path.dirname(path.dirname(tools.node.path))
        ],
        writableRoots: [
          writable,
          ...(context.allowCheckoutWrite === true
            ? [context.roots[host]]
            : [])
        ],
        pathAliases: [{
          path: context.workspace,
          identity: '$WORKSPACE'
        }],
        allowNetwork: context.allowNetwork === true
      });
      return execution(
        context.id,
        argv,
        sequence++,
        failure === 'command'
          && host === 'codex'
          && context.id === 'host-smoke'
          ? 1
          : 0,
        null,
        sandbox
      );
    },
    environmentDigest() {
      return '8'.repeat(64);
    },
    cleanup() {}
  });
}

test('production host artifact generator writes proof-consumable receipts', (t) => {
  const fixture = prepareProject(t);
  const fakeVerificationRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-host-artifacts-malicious-root-')
  );
  const previousVerificationRoot =
    process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT;
  process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT = fakeVerificationRoot;
  t.after(() => {
    if (previousVerificationRoot === undefined) {
      delete process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT;
    } else {
      process.env.SPECNAV_SPECNAV_VERIFICATION_ROOT =
        previousVerificationRoot;
    }
    fs.rmSync(fakeVerificationRoot, { recursive: true, force: true });
  });
  const generator = createHostArtifactGenerator({
    authorityFactory: () => fixture.hosts.authority(),
    launcherFactory: launcherFixture(fixture),
    managedFixtureRoot: fixture.hosts.fixtureRoot,
    runnerSourceResolver: () => ({
      local: RUNNER_SOURCE_SHA256,
      locked: RUNNER_SOURCE_SHA256
    }),
    sourceInventoryResolver: () => fixture.sourceCodeSha,
    nonce: () => 'a'.repeat(64),
    clock: (() => {
      let tick = 0;
      return () => `2026-08-09T12:01:${String(tick++).padStart(2, '0')}.000Z`;
    })()
  });

  const result = generator.generate({
    projectRoot: fixture.root,
    changeId: CHANGE,
    lockFile: fixture.hosts.lockFile
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.hosts.length, 4);
  const pointer = JSON.parse(fs.readFileSync(
    path.join(fixture.operations, 'host-proof-current.json'),
    'utf8'
  ));
  const index = JSON.parse(fs.readFileSync(path.join(
    fixture.root,
    'openspec',
    'changes',
    CHANGE,
    pointer.index.path
  ), 'utf8'));
  assert.deepEqual(
    index.hosts.map((entry) => entry.host),
    ['claude-code', 'codex', 'codefree-o', 'dsh']
  );
  for (const entry of index.hosts) {
    const receipt = JSON.parse(fs.readFileSync(
      path.join(
        fixture.root,
        'openspec',
        'changes',
        CHANGE,
        entry.receipt_path
      ),
      'utf8'
    ));
    assert.equal(receipt.remote_commit_reachable, true);
    assert.equal(receipt.attestation, 'system-executed');
    assert.equal(receipt.fallback_used, false);
    assert.match(receipt.execution_envelope_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      receipt.checks.map((check) => check.id).sort(),
      [
        'host-smoke',
        'plugin-discovery',
        'remote-commit-reachability',
        'runtime-doctor'
      ]
    );
  }
  const proof = createReleaseProofValidator({
    requireHostProof: true,
    expectedHostRunnerSourceSha256: RUNNER_SOURCE_SHA256,
    expectedFixtureManifestSha256: managedFixtureManifestDigest(
      fixture.hosts.fixtureRoot
    ),
    clock: () => '2026-08-09T12:02:00.000Z'
  }).validate(fixture.root, CHANGE);
  assert.equal(proof.ok, true, JSON.stringify(proof.blockers));
});

test('remote or host command failure cannot publish official host artifacts', (t) => {
  for (const failure of ['remote', 'command']) {
    const fixture = prepareProject(t);
    const generator = createHostArtifactGenerator({
      authorityFactory: () => fixture.hosts.authority(),
      launcherFactory: launcherFixture(fixture, failure),
      managedFixtureRoot: fixture.hosts.fixtureRoot,
      runnerSourceResolver: () => ({
        local: RUNNER_SOURCE_SHA256,
        locked: RUNNER_SOURCE_SHA256
      }),
      sourceInventoryResolver: () => fixture.sourceCodeSha,
      nonce: () => failure.repeat(32).slice(0, 64),
      clock: () => '2026-08-09T12:03:00.000Z'
    });

    const result = generator.generate({
      projectRoot: fixture.root,
      changeId: CHANGE,
      lockFile: fixture.hosts.lockFile
    });

    assert.equal(result.ok, false, failure);
    assert.equal(
      fs.existsSync(path.join(
        fixture.operations,
        'host-proof-current.json'
      )),
      false,
      failure
    );
    if (failure === 'command') {
      assert.equal(
        result.artifacts.some((entry) => (
          entry.endsWith('.execution-envelope.json')
        )),
        true
      );
    }
  }
});

test('a stale writer cannot replace a newer host proof pointer', (t) => {
  const fixture = prepareProject(t);
  const pointerFile = path.join(
    fixture.operations,
    'host-proof-current.json'
  );
  const pointerBase = {
    schema: 'specnav.verification.host-proof-pointer.v1',
    change_id: CHANGE,
    run_id: 'host-proof-existing',
    host_lock_sha256: 'a'.repeat(64),
    runtime_authority_digest: 'b'.repeat(64),
    generation: 1,
    previous_pointer: null,
    lock: {
      path: 'operations/host-proof-runs/host-proof-existing/cross-host-lock.json',
      sha256: 'a'.repeat(64)
    },
    index: {
      path: 'operations/host-proof-runs/host-proof-existing/host-installation-index.json',
      sha256: 'c'.repeat(64)
    },
    compatibility: {
      path: 'operations/host-proof-runs/host-proof-existing/cross-host-compatibility.json',
      sha256: 'd'.repeat(64)
    },
    published_at: '2026-08-09T12:04:00.000Z',
    fallback_used: false
  };
  fs.writeFileSync(pointerFile, `${JSON.stringify(pointerBase, null, 2)}\n`);
  const initialBytes = fs.readFileSync(pointerFile);
  const concurrentPointer = {
    ...pointerBase,
    run_id: 'host-proof-concurrent',
    generation: 2,
    previous_pointer: {
      path: (
        'operations/host-proof-runs/host-proof-existing/'
        + 'host-proof-pointer.json'
      ),
      sha256: require('node:crypto')
        .createHash('sha256')
        .update(initialBytes)
        .digest('hex')
    },
    published_at: '2026-08-09T12:04:01.000Z'
  };
  const concurrentBytes = Buffer.from(
    `${JSON.stringify(concurrentPointer, null, 2)}\n`
  );
  const generator = createHostArtifactGenerator({
    authorityFactory: () => fixture.hosts.authority(),
    launcherFactory: launcherFixture(fixture, null, () => {
      fs.writeFileSync(pointerFile, concurrentBytes);
    }),
    managedFixtureRoot: fixture.hosts.fixtureRoot,
    runnerSourceResolver: () => ({
      local: RUNNER_SOURCE_SHA256,
      locked: RUNNER_SOURCE_SHA256
    }),
    sourceInventoryResolver: () => fixture.sourceCodeSha,
    nonce: () => 'c'.repeat(64),
    clock: () => '2026-08-09T12:04:02.000Z'
  });

  const result = generator.generate({
    projectRoot: fixture.root,
    changeId: CHANGE,
    lockFile: fixture.hosts.lockFile
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((entry) => (
      entry.id === 'verification-host-artifacts:stale-pointer'
    )),
    true,
    JSON.stringify(result.blockers)
  );
  assert.deepEqual(fs.readFileSync(pointerFile), concurrentBytes);
});

test('runner source digest covers trusted execution dependencies', (t) => {
  const fixture = runnerSourceFixture(t);
  const baseline = hostProofRunnerSourceDigest(fixture.root);
  const targets = [
    'plugins/specnav-operations/scripts/safe-filesystem.py',
    'plugins/specnav-operations/scripts/verification-v2-pointer-chain.js',
    'plugins/specnav-operations/scripts/verification-v2-trusted-runtime.js',
    'plugins/specnav-verification/kernel/repair/trusted-fact-authority.js',
    'plugins/specnav-verification/schemas/trusted-fact-envelope.schema.json'
  ];

  for (const relative of targets) {
    assert.equal(
      fixture.files.includes(relative),
      true,
      `${relative} must be part of the runner source closure`
    );
    const file = path.join(fixture.root, relative);
    const original = fs.readFileSync(file);
    fs.appendFileSync(file, '\nrunner-source-tamper\n');
    assert.notEqual(
      hostProofRunnerSourceDigest(fixture.root),
      baseline,
      `${relative} tampering must change runner_source_sha256`
    );
    fs.writeFileSync(file, original);
    assert.equal(hostProofRunnerSourceDigest(fixture.root), baseline);
  }
});
