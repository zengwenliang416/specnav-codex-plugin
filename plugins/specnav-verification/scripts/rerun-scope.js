#!/usr/bin/env node
'use strict';

// Computes the minimal verification rerun set from a git diff and the
// traceability matrix. Deterministic replacement for "pick domains by feel":
// changed files map to matrix entries; the union of their verification
// domains is what must rerun. Unmapped changed files fail conservatively to
// a full-domain rerun with an explicit warning.

const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

const ALL_DOMAINS = ['facticity', 'static', 'unit', 'redteam', 'e2e', 'sensory'];

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function changedFiles(projectRoot, baseRef) {
  const ref = baseRef || 'HEAD';
  const result = lib.runCommand(`git diff --name-only ${lib.shellQuote(ref)}`, {
    cwd: projectRoot,
    timeoutMs: 30000
  });
  if (!result.ok) return { ok: false, error: result.stderr.trim() || `git diff exited ${result.status}`, files: [] };
  const untracked = lib.runCommand('git ls-files --others --exclude-standard', {
    cwd: projectRoot,
    timeoutMs: 30000
  });
  const files = new Set(
    result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  );
  if (untracked.ok) {
    for (const line of untracked.stdout.split(/\r?\n/)) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return { ok: true, files: Array.from(files).filter((file) => !file.startsWith('openspec/')) };
}

function computeRerunScope(projectRoot, options = {}) {
  const changeState = lib.activeChangeState(projectRoot, options.change !== undefined ? { change: options.change } : {});
  const change = changeState.change;
  if (!change) {
    return { ok: false, change: null, blockers: changeState.blockers.length ? changeState.blockers : ['active-change'] };
  }
  const changeDir = lib.changeDir(projectRoot, change);
  const matrix = lib.readJson(path.join(changeDir, 'verify', 'traceability-matrix.json'), null);
  if (!matrix || !Array.isArray(matrix.entries)) {
    return {
      ok: false,
      change,
      blockers: ['missing-verify-artifact:traceability-matrix.json'],
      domains_to_rerun: ALL_DOMAINS,
      reason: 'no traceability matrix; full rerun required'
    };
  }

  const diff = options.files
    ? { ok: true, files: options.files }
    : changedFiles(projectRoot, options.baseRef);
  if (!diff.ok) {
    return { ok: false, change, blockers: [`git-diff-failed:${diff.error}`], domains_to_rerun: ALL_DOMAINS };
  }

  const domains = new Set();
  const invalidated = [];
  const unmapped = [];

  for (const file of diff.files) {
    const entries = matrix.entries.filter((entry) => entry && entry.changed_file === file);
    if (!entries.length) {
      unmapped.push(file);
      continue;
    }
    for (const entry of entries) {
      invalidated.push({
        changed_file: file,
        requirement_refs: entry.requirement_refs || [],
        task_refs: entry.task_refs || []
      });
      for (const domain of entry.verification_domains || []) {
        if (ALL_DOMAINS.includes(domain)) domains.add(domain);
      }
    }
  }

  // Conservative failure: an unmapped production change means the matrix does
  // not know the blast radius — rerun everything and surface the gap.
  const fullRerun = unmapped.length > 0;
  const domainsToRerun = fullRerun ? ALL_DOMAINS : Array.from(domains).sort();

  return {
    ok: true,
    change,
    changed_files: diff.files,
    invalidated_entries: invalidated,
    unmapped_changes: unmapped,
    full_rerun: fullRerun,
    domains_to_rerun: domainsToRerun,
    warnings: fullRerun ? [`unmapped-changes: ${unmapped.join(', ')} — matrix does not cover these files; rerunning all domains`] : [],
    blockers: []
  };
}

function main() {
  const args = process.argv.slice(2);
  const root = lib.projectRoot();
  const change = argValue(args, '--change', null);
  const baseRef = argValue(args, '--base', null);
  const filesArg = argValue(args, '--files', null);
  const result = computeRerunScope(root, {
    ...(change ? { change } : {}),
    ...(baseRef ? { baseRef } : {}),
    ...(filesArg ? { files: filesArg.split(',').map((file) => file.trim()).filter(Boolean) } : {})
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { computeRerunScope, ALL_DOMAINS };
