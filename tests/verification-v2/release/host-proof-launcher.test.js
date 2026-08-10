'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createHostSandboxPlan,
  createHostProofLauncher
} = require(
  '../../../plugins/specnav-verification/kernel/execution/host-proof-launcher'
);

const sandboxAvailable = process.platform === 'darwin'
  ? fs.existsSync('/usr/bin/sandbox-exec')
  : ['/usr/bin/bwrap', '/bin/bwrap'].some((file) => fs.existsSync(file));

test('sandbox and environment identities ignore mkdtemp root names', (t) => {
  const fixtures = ['a', 'b'].map((name) => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), `specnav-host-identity-${name}-`)
    );
    const roots = Object.fromEntries(
      ['claude-code', 'codex', 'codefree-o'].map((host) => {
        const root = path.join(workspace, host);
        fs.mkdirSync(root, { recursive: true });
        return [host, root];
      })
    );
    const writable = path.join(workspace, '.runtime', 'codex');
    fs.mkdirSync(writable, { recursive: true });
    return { workspace, roots, writable };
  });
  t.after(() => {
    for (const fixture of fixtures) {
      fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
  });
  const tools = {
    node: { path: '/toolchain/bin/node', sha256: '1'.repeat(64) },
    git: { path: '/toolchain/bin/git', sha256: '2'.repeat(64) },
    bash: { path: '/toolchain/bin/bash', sha256: '3'.repeat(64) },
    npm: { path: '/toolchain/bin/npm', sha256: '4'.repeat(64) },
    sandbox: { path: '/toolchain/bin/sandbox', sha256: '5'.repeat(64) }
  };

  for (const platform of ['darwin', 'linux']) {
    const plans = fixtures.map((fixture) => createHostSandboxPlan({
      platform,
      toolchain: tools,
      allowedRoots: Object.values(fixture.roots),
      writableRoots: [fixture.writable],
      pathAliases: [{
        path: fixture.workspace,
        identity: '$WORKSPACE'
      }],
      allowNetwork: false
    }));

    assert.equal(plans[0].policy_sha256, plans[1].policy_sha256, platform);
    assert.notDeepEqual(plans[0].argv, plans[1].argv, platform);
    assert.match(
      plans[0].argv.join(' '),
      new RegExp(fixtures[0].workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
    assert.match(
      plans[1].argv.join(' '),
      new RegExp(fixtures[1].workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );

    const widened = createHostSandboxPlan({
      platform,
      toolchain: tools,
      allowedRoots: Object.values(fixtures[0].roots),
      writableRoots: [
        fixtures[0].writable,
        fixtures[0].roots.codex
      ],
      pathAliases: [{
        path: fixtures[0].workspace,
        identity: '$WORKSPACE'
      }],
      allowNetwork: false
    });
    assert.notEqual(plans[0].policy_sha256, widened.policy_sha256, platform);
  }

  const launcher = createHostProofLauncher({
    toolchain: tools,
    hosts: ['claude-code', 'codex', 'codefree-o'],
    sourceHost: 'codex',
    dependencyHosts: ['codefree-o']
  });
  const runtimeAuthority = { digest: '6'.repeat(64) };
  assert.equal(
    launcher.environmentDigest(fixtures[0], runtimeAuthority),
    launcher.environmentDigest(fixtures[1], runtimeAuthority)
  );
  assert.notEqual(
    launcher.environmentDigest(fixtures[0], runtimeAuthority),
    launcher.environmentDigest({
      ...fixtures[0],
      roots: {
        ...fixtures[0].roots,
        codex: path.join(fixtures[0].workspace, 'different-codex-root')
      }
    }, runtimeAuthority)
  );
});

test(
  'host-smoke sandbox cannot stat the managed runtime authority key',
  { skip: !sandboxAvailable },
  (t) => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'specnav-host-sandbox-')
    );
    const runtimeRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'specnav-managed-runtime-')
    );
    t.after(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    });
    const roots = Object.fromEntries(
      ['claude-code', 'codex', 'codefree-o'].map((host) => {
        const root = path.join(workspace, host);
        fs.mkdirSync(root, { recursive: true });
        return [host, root];
      })
    );
    const authorityKey = path.join(runtimeRoot, 'authority.key');
    fs.writeFileSync(authorityKey, 'test-only-secret\n', { mode: 0o600 });
    const launcher = createHostProofLauncher({
      hosts: ['claude-code', 'codex', 'codefree-o'],
      sourceHost: 'codex',
      dependencyHosts: ['codefree-o']
    });

    const result = launcher.run(
      'codex',
      ['/usr/bin/stat', authorityKey],
      {
        id: 'host-smoke',
        workspace,
        roots,
        runtimeRoot,
        trustedRoots: [],
        allowRuntime: false,
        timeoutMs: 60000
      }
    );

    assert.equal(
      result.exit_status !== 0 || result.signal !== null,
      true
    );
    assert.equal(result.stdout.length, 0);
  }
);
