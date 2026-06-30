#!/usr/bin/env node
'use strict';

const path = require('path');
const childProcess = require('child_process');
const statusManager = require('./codegraph-status-manager');
const store = require('./codegraph-evidence-store');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function runExplore(projectRoot, query) {
  const result = childProcess.spawnSync('codegraph', ['explore', query], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60000
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    error: result.error ? result.error.message : null,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function extractFiles(text) {
  const found = new Map();
  const pattern = /(?:^|[\s"'(])([A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs|swift|kt|md|json|ya?ml|toml|sql|css|scss|html))(?::(\d+)(?:-(\d+))?)?/gm;
  for (const match of String(text || '').matchAll(pattern)) {
    const file = match[1].replace(/^\.\//, '');
    if (!found.has(file)) {
      found.set(file, {
        path: file,
        symbols: [],
        lines: match[2] ? `${match[2]}${match[3] ? `-${match[3]}` : ''}` : null
      });
    }
  }
  return Array.from(found.values());
}

function evidenceId() {
  return `ev-${Date.now().toString(36)}`;
}

function build(options = {}) {
  const query = options.query;
  if (!query || !query.trim()) {
    return { ok: false, blockers: ['codegraph:missing-query'] };
  }

  const status = statusManager.status({
    projectRoot: options.projectRoot,
    stage: options.stage || 'development',
    change: options.change || null
  });
  if (!status.cli.available) {
    return { ok: false, status, blockers: ['codegraph:cli-missing'] };
  }
  if (status.cli.unsupported === true) {
    return { ok: false, status, blockers: ['codegraph:unsupported-version'] };
  }
  if (!status.index.initialized) {
    return { ok: false, status, blockers: ['codegraph:not-indexed'] };
  }
  if (status.index.worktreeMismatch) {
    return { ok: false, status, blockers: ['codegraph:wrong-project-root'] };
  }
  const pending = status.index.pendingChanges || {};
  const hasPending = ['added', 'modified', 'removed'].some((key) => Number(pending[key] || 0) > 0);
  if (status.index.reindexRecommended === true || hasPending) {
    return { ok: false, status, blockers: ['codegraph:index-stale'] };
  }

  const explored = runExplore(status.project_root, query.trim());
  const output = `${explored.stdout}\n${explored.stderr}`.trim();
  const record = {
    schema: 'specnav.codegraph.evidence.v1',
    id: evidenceId(),
    generated_at: new Date().toISOString(),
    stage: options.stage || 'development',
    task_id: options.task || null,
    claim_id: options.claim || null,
    query: query.trim(),
    tool: 'cli:codegraph explore',
    project_path: status.project_root,
    result_summary: output.slice(0, 500),
    files: extractFiles(output),
    relationships: [],
    confidence: explored.ok && output ? 'matched' : 'missing',
    blockers: explored.ok && output ? [] : ['codegraph:claim-unverified']
  };

  const result = {
    ok: record.blockers.length === 0,
    status,
    evidence: record,
    blockers: record.blockers
  };

  const change = options.change || status.active_change || store.activeChange(status.project_root);
  if (options.write && change) {
    const dir = store.defaultChangeCodegraphDir(status.project_root, change);
    const rawFile = path.join(dir, 'evidence.jsonl');
    const indexFile = path.join(dir, 'evidence-index.json');
    store.writeJson(path.join(dir, 'status.json'), status);
    store.appendEvidence(rawFile, record);
    const index = store.loadOrBuildIndex(rawFile, indexFile, {
      activeChange: change,
      sourceRaw: `openspec/changes/${change}/codegraph/evidence.jsonl`
    });
    result.written = { raw: rawFile, index: indexFile };
    result.evidence_index = index;
  }

  return result;
}

function main(argv = process.argv.slice(2)) {
  if (hasFlag(argv, '--help')) {
    process.stdout.write('Usage: codegraph-context.js --query "question" [--project <dir>] [--change <id>] [--stage <stage>] [--claim <id>] [--task <id>] [--write] [--json]\n');
    return 0;
  }
  const result = build({
    projectRoot: argValue(argv, '--project', null),
    change: argValue(argv, '--change', null),
    stage: argValue(argv, '--stage', 'development'),
    claim: argValue(argv, '--claim', null),
    task: argValue(argv, '--task', null),
    query: argValue(argv, '--query', null),
    write: hasFlag(argv, '--write')
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = {
  build,
  main
};
