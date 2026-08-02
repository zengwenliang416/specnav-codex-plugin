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
    host === sourceHost ? lock.source_commit : lock.hosts?.[host]?.ref
  ]));
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
      if (
        lock.schema !== 'specnav.verification.cross-host-lock.v1'
        || !/^[a-f0-9]{40}$/.test(lock.source_commit || '')
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
    for (const [host, descriptor] of Object.entries(config.descriptors)) {
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
            : lock.source_commit
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
