'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_PLUGIN = path.join(ROOT, 'plugins/specnav-verification');
const FIXTURE_ROOT = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures'
);
const {
  buildStagedPlugin
} = require('../../../integrations/claude-code/sync-verification-plugin');
const {
  buildStagedModule
} = require('../../../integrations/codefree-o/sync-verification-module');
const kernel = require(SOURCE_PLUGIN);

const HOST_DESCRIPTORS = Object.freeze({
  codex: Object.freeze({
    plugin: 'plugins/specnav-verification',
    manifest: null,
    hostFiles: Object.freeze(['scripts/codex-verification-adapter.js'])
  }),
  'claude-code': Object.freeze({
    plugin: 'plugins/specnav-verification',
    manifest: 'plugins/specnav-verification/specnav-kernel-source.json',
    hostFiles: Object.freeze([
      'commands/specnav-verification.md',
      'commands/specnav-verify.md',
      'scripts/claude-verification-adapter.js',
      'scripts/plugin-runtime.js',
      'specnav-stage.json',
      '.claude-plugin/plugin.json'
    ])
  }),
  'codefree-o': Object.freeze({
    plugin: 'modules/specnav-verification',
    manifest: 'modules/specnav-verification/specnav-kernel-source.json',
    hostFiles: Object.freeze([
      'scripts/codefree-o-verification-adapter.js',
      'scripts/plugin-runtime.js',
      'specnav-stage.json'
    ])
  })
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-08-02T00:00:00+08:00',
      GIT_COMMITTER_DATE: '2026-08-02T00:00:00+08:00'
    }
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function initializeRepository(root, message) {
  git(root, ['init']);
  git(root, ['config', 'user.email', 'specnav@example.test']);
  git(root, ['config', 'user.name', 'SpecNav Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function rewriteSourceBinding(pluginRoot, sourceCommit) {
  const file = path.join(pluginRoot, 'specnav-kernel-source.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.generated_at = '2026-08-02T00:00:00.000Z';
  manifest.source_commit = sourceCommit;
  manifest.source_dirty = false;
  writeJson(file, manifest);
}

function materializeHost(root, host, sourceCommit) {
  const descriptor = HOST_DESCRIPTORS[host];
  const pluginRoot = path.join(root, descriptor.plugin);
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(SOURCE_PLUGIN, 'scripts/plugin-runtime.js'),
    path.join(pluginRoot, 'scripts/plugin-runtime.js')
  );
  if (host === 'claude-code') buildStagedPlugin(pluginRoot);
  else buildStagedModule(pluginRoot);
  rewriteSourceBinding(pluginRoot, sourceCommit);
  return {
    root,
    pluginRoot,
    manifestFile: path.join(root, descriptor.manifest)
  };
}

function createHostAuthorityFixture(t) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-host-authority-')
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const roots = {
    codex: path.join(tempRoot, 'codex'),
    'claude-code': path.join(tempRoot, 'claude'),
    'codefree-o': path.join(tempRoot, 'codefree')
  };
  const sourcePlugin = path.join(
    roots.codex,
    HOST_DESCRIPTORS.codex.plugin
  );
  fs.mkdirSync(path.dirname(sourcePlugin), { recursive: true });
  fs.cpSync(SOURCE_PLUGIN, sourcePlugin, { recursive: true });
  const sourceCommit = initializeRepository(
    roots.codex,
    'fixture: source host'
  );

  for (const host of ['claude-code', 'codefree-o']) {
    fs.mkdirSync(roots[host], { recursive: true });
    materializeHost(roots[host], host, sourceCommit);
    initializeRepository(roots[host], `fixture: ${host} host`);
  }

  const lockFile = path.join(tempRoot, 'host-lock.json');
  const lock = {
    schema: 'specnav.verification.cross-host-lock.v1',
    source_commit: sourceCommit,
    hosts: {
      'claude-code': {
        repository: 'fixture/claude',
        ref: git(roots['claude-code'], ['rev-parse', 'HEAD'])
      },
      'codefree-o': {
        repository: 'fixture/codefree',
        ref: git(roots['codefree-o'], ['rev-parse', 'HEAD'])
      }
    }
  };
  writeJson(lockFile, lock);

  function authority(overrides = {}) {
    return kernel.createHostCompatibilityAuthority({
      lockFile: overrides.lockFile || lockFile,
      fixtureRoot: overrides.fixtureRoot || FIXTURE_ROOT,
      descriptors: HOST_DESCRIPTORS,
      sourceHost: 'codex',
      roots: { ...roots, ...(overrides.roots || {}) }
    });
  }

  function readLock() {
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  }

  function updateHostRef(host) {
    const current = readLock();
    current.hosts[host].ref = git(roots[host], ['rev-parse', 'HEAD']);
    writeJson(lockFile, current);
  }

  function commitHost(host, message) {
    git(roots[host], ['add', '.']);
    git(roots[host], ['commit', '-m', message]);
    updateHostRef(host);
  }

  function mutateManifest(host, mutate) {
    const file = path.join(roots[host], HOST_DESCRIPTORS[host].manifest);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(manifest, path.dirname(file));
    writeJson(file, manifest);
    return file;
  }

  return {
    authority,
    commitHost,
    descriptors: HOST_DESCRIPTORS,
    fixtureRoot: FIXTURE_ROOT,
    lockFile,
    mutateManifest,
    readLock,
    roots,
    sha256,
    sourceCommit,
    updateHostRef,
    writeJson
  };
}

module.exports = {
  HOST_DESCRIPTORS,
  createHostAuthorityFixture,
  git,
  sha256,
  writeJson
};
