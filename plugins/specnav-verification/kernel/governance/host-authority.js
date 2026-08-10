'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createCompatibilitySnapshot } = require('./compatibility-snapshot');
const {
  compareCompatibilitySnapshots
} = require('./cross-host-drift');

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

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function expectedCommits(lock, descriptors, sourceHost) {
  return Object.fromEntries(Object.keys(descriptors).map((host) => [
    host,
    host === sourceHost ? lock.source?.commit : lock.hosts?.[host]?.commit
  ]));
}

function repositoryLock(lock, host, sourceHost) {
  return host === sourceHost ? lock.source : lock.hosts?.[host];
}

function validRepositoryLock(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/.test(
      value.repository || ''
    )
    && /^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/.test(value.ref || '')
    && /^[a-f0-9]{40}$/.test(value.commit || '')
    && typeof value.plugin_path === 'string'
    && value.plugin_path !== ''
    && (
      value.manifest_path === null
      || (
        typeof value.manifest_path === 'string'
        && value.manifest_path !== ''
      )
    );
}

function createHostCompatibilityAuthority(options = {}) {
  const config = {
    lockFile: options.lockFile,
    fixtureRoot: options.fixtureRoot,
    roots: options.roots || {},
    descriptors: options.descriptors || {},
    sourceHost: options.sourceHost
  };

  function resolve() {
    const blockers = [];
    const hosts = Object.keys(config.descriptors).sort();
    if (
      hosts.length < 2
      || typeof config.sourceHost !== 'string'
      || !hosts.includes(config.sourceHost)
    ) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-release:host-descriptors-invalid',
          'host-descriptors'
        )]
      };
    }
    let lock;
    let lockBytes;
    try {
      if (typeof config.lockFile !== 'string') {
        throw new Error('lock-file-missing');
      }
      lockBytes = fs.readFileSync(fs.realpathSync(config.lockFile));
      lock = JSON.parse(lockBytes.toString('utf8'));
      const downstreamHosts = hosts.filter((host) => host !== config.sourceHost);
      if (
        lock.schema !== 'specnav.verification.cross-host-lock.v1'
        || lock.source_host !== config.sourceHost
        || !validRepositoryLock(lock.source)
        || !lock.hosts
        || typeof lock.hosts !== 'object'
        || Array.isArray(lock.hosts)
        || Object.keys(lock.hosts).sort().join('\0')
          !== downstreamHosts.sort().join('\0')
        || downstreamHosts.some((host) => !validRepositoryLock(lock.hosts[host]))
        || lock.fallback_used !== false
      ) {
        throw new Error('lock-invalid');
      }
    } catch (error) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-release:host-lock-invalid',
          config.lockFile || 'host-lock',
          error instanceof Error ? error.message : String(error)
        )]
      };
    }
    let fixtureRoot;
    try {
      fixtureRoot = fs.realpathSync(config.fixtureRoot);
      if (!fs.statSync(fixtureRoot).isDirectory()) {
        throw new Error('fixture-root-not-directory');
      }
    } catch (error) {
      blockers.push(blocker(
        'verification-release:host-fixture-root-invalid',
        config.fixtureRoot || 'fixture-root',
        error instanceof Error ? error.message : String(error)
      ));
    }
    const expected = expectedCommits(
      lock,
      config.descriptors,
      config.sourceHost
    );
    const snapshots = {};
    const heads = {};
    const roots = {};
    for (const [host, descriptor] of Object.entries(config.descriptors)) {
      const lockedRepository = repositoryLock(lock, host, config.sourceHost);
      if (
        lockedRepository.plugin_path !== descriptor.plugin
        || lockedRepository.manifest_path !== descriptor.manifest
      ) {
        blockers.push(blocker(
          `verification-release:host-lock-descriptor-mismatch:${host}`,
          config.lockFile
        ));
        continue;
      }
      let repositoryRoot;
      try {
        repositoryRoot = fs.realpathSync(config.roots[host]);
        if (!fs.statSync(repositoryRoot).isDirectory()) {
          throw new Error('repository-root-not-directory');
        }
      } catch (error) {
        blockers.push(blocker(
          `verification-release:host-root-missing:${host}`,
          config.roots[host] || host,
          error instanceof Error ? error.message : String(error)
        ));
        continue;
      }
      roots[host] = repositoryRoot;
      try {
        const head = git(repositoryRoot, ['rev-parse', 'HEAD']);
        const dirty = git(repositoryRoot, [
          'status',
          '--porcelain=v1',
          '--untracked-files=all'
        ]);
        heads[host] = head;
        if (head !== expected[host]) {
          blockers.push(blocker(
            `verification-release:host-head-mismatch:${host}`,
            repositoryRoot,
            { expected: expected[host], actual: head }
          ));
        }
        if (dirty !== '') {
          blockers.push(blocker(
            `verification-release:host-worktree-dirty:${host}`,
            repositoryRoot
          ));
        }
        if (!fixtureRoot) continue;
        const pluginRoot = path.join(repositoryRoot, descriptor.plugin);
        snapshots[host] = createCompatibilitySnapshot({
          host,
          pluginRoot,
          fixtureRoot,
          manifestFile: descriptor.manifest
            ? path.join(repositoryRoot, descriptor.manifest)
            : null,
          hostFiles: descriptor.hostFiles,
          expectedSourceCommit: host === config.sourceHost
            ? null
            : lock.source.commit
        });
      } catch (error) {
        blockers.push(blocker(
          `verification-release:host-snapshot-failed:${host}`,
          repositoryRoot,
          error instanceof Error ? error.message : String(error)
        ));
      }
    }
    let comparison = null;
    if (Object.keys(snapshots).length === hosts.length) {
      comparison = compareCompatibilitySnapshots(
        snapshots[config.sourceHost],
        hosts
          .filter((host) => host !== config.sourceHost)
          .map((host) => snapshots[host])
      );
      blockers.push(...comparison.blockers.map((entry) => blocker(
        entry.id,
        entry.artifact || 'host-compatibility',
        entry.detail || null
      )));
    }
    const summary = {
      lock_sha256: sha256(lockBytes),
      commits: expected,
      repositories: Object.fromEntries(hosts.map((host) => [
        host,
        repositoryLock(lock, host, config.sourceHost).repository
      ])),
      heads,
      snapshots: Object.fromEntries(
        Object.entries(snapshots).map(([host, snapshot]) => [
          host,
          sha256(canonicalJson(snapshot))
        ])
      ),
      comparison: comparison
        ? sha256(canonicalJson(comparison))
        : null
    };
    return {
      ok: blockers.length === 0 && comparison?.ok === true,
      lock,
      commits: expected,
      roots,
      snapshots,
      comparison,
      summary: {
        ...summary,
        digest: sha256(canonicalJson(summary))
      },
      blockers
    };
  }

  return Object.freeze({ resolve });
}

module.exports = {
  createHostCompatibilityAuthority
};
