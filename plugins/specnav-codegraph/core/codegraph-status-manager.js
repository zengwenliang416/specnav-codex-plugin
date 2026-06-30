#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const decision = require('./codegraph-decision-engine');

const MIN_VERSION = '1.1.6';

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    timeout: options.timeout || 10000
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    error: result.error ? result.error.message : null,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseVersion(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match[0] : null;
}

function compareVersions(a, b) {
  const left = String(a || '0.0.0').split('.').map((part) => Number(part) || 0);
  const right = String(b || '0.0.0').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function detectCli(projectRoot) {
  const versionResult = run('codegraph', ['version'], { cwd: projectRoot });
  if (!versionResult.ok) {
    return {
      available: false,
      version: null,
      path: null,
      unsupported: false,
      error: versionResult.error || versionResult.stderr || 'codegraph command failed'
    };
  }
  const which = run('which', ['codegraph'], { cwd: projectRoot });
  const version = parseVersion(versionResult.stdout || versionResult.stderr);
  return {
    available: true,
    version,
    path: which.ok ? which.stdout.trim() : 'codegraph',
    unsupported: !version || compareVersions(version, MIN_VERSION) < 0,
    error: null
  };
}

function parseCodegraphStatus(projectRoot, cliAvailable) {
  if (!cliAvailable) return null;
  const result = run('codegraph', ['status', '--json'], { cwd: projectRoot, timeout: 20000 });
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function detectMcp(projectRoot) {
  const home = os.homedir();
  const files = [
    path.join(home, '.claude.json'),
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.codex', 'config.toml'),
    path.join(projectRoot, '.mcp.json'),
    path.join(projectRoot, '.codex', 'config.toml')
  ];
  const matches = files.filter((file) => /codegraph/.test(readText(file)) && /mcp|serve/.test(readText(file)));
  const visible = process.env.SPECNAV_CODEGRAPH_MCP_VISIBLE === '1' || process.env.CODEGRAPH_MCP_VISIBLE === '1';
  return {
    configured: matches.length > 0,
    visible_in_current_session: visible,
    restart_required: matches.length > 0 && !visible,
    config_files: matches
  };
}

function pendingFromStatus(statusJson) {
  const pending = statusJson && (statusJson.pendingChanges || statusJson.pending_changes);
  return {
    added: Number(pending && pending.added || 0),
    modified: Number(pending && pending.modified || 0),
    removed: Number(pending && pending.removed || 0)
  };
}

function realpathOrResolve(file) {
  try {
    return (fs.realpathSync.native || fs.realpathSync)(file);
  } catch {
    return path.resolve(file);
  }
}

function detectIndex(projectRoot, statusJson) {
  const codegraphDir = path.join(projectRoot, '.codegraph');
  const statusInitialized = statusJson && typeof statusJson.initialized === 'boolean'
    ? statusJson.initialized
    : null;
  const initialized = statusInitialized === null ? fs.existsSync(codegraphDir) : statusInitialized;
  const projectPath = statusJson && (statusJson.projectPath || statusJson.project_path || statusJson.projectRoot || statusJson.project_root);
  const indexPath = statusJson && (statusJson.indexPath || statusJson.index_path || null);
  const resolvedProjectPath = projectPath ? path.resolve(projectPath) : (initialized ? projectRoot : null);
  const rootMismatch = resolvedProjectPath && realpathOrResolve(resolvedProjectPath) !== realpathOrResolve(projectRoot);
  return {
    initialized,
    projectPath: resolvedProjectPath,
    indexPath: initialized ? path.resolve(indexPath || codegraphDir) : null,
    lastIndexed: statusJson && (statusJson.lastIndexed || statusJson.last_indexed || null),
    fileCount: Number(statusJson && (statusJson.fileCount || statusJson.file_count) || 0),
    nodeCount: Number(statusJson && (statusJson.nodeCount || statusJson.node_count) || 0),
    edgeCount: Number(statusJson && (statusJson.edgeCount || statusJson.edge_count) || 0),
    pendingChanges: pendingFromStatus(statusJson),
    reindexRecommended: !!(statusJson && (statusJson.reindexRecommended || statusJson.reindex_recommended)),
    worktreeMismatch: rootMismatch
      ? { expected: projectRoot, actual: resolvedProjectPath }
      : null
  };
}

function readPolicy(projectRoot, options = {}) {
  const projectConfig = readJson(path.join(projectRoot, '.specnav.json'), {});
  const openspecPolicy = readJson(path.join(projectRoot, 'openspec', '.specnav', 'codegraph-policy.json'), {});
  const directPolicy = options.policy || {};
  const fromProject = projectConfig && (projectConfig.codegraph_policy || projectConfig.codegraph || {});
  return {
    ...fromProject,
    ...openspecPolicy,
    ...directPolicy
  };
}

function activeChange(projectRoot) {
  const envChange = process.env.SPECNAV_CHANGE;
  if (envChange && envChange.trim()) return envChange.trim();
  try {
    const value = fs.readFileSync(path.join(projectRoot, 'openspec', '.specnav', 'active-change'), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function projectRootFrom(options = {}) {
  return path.resolve(options.projectRoot || process.env.PROJECT_DIR || process.env.PWD || process.cwd());
}

function status(options = {}) {
  const projectRoot = projectRootFrom(options);
  const stage = options.stage || 'development';
  const cli = detectCli(projectRoot);
  const statusJson = parseCodegraphStatus(projectRoot, cli.available);
  const mcp = detectMcp(projectRoot);
  const index = detectIndex(projectRoot, statusJson);
  const policyInput = readPolicy(projectRoot, {
    policy: {
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.mode ? { mode: options.mode } : {})
    }
  });
  const executionSurface = mcp.visible_in_current_session ? 'mcp' : (cli.available ? 'cli' : 'none');
  const partialStatus = {
    execution_surface: executionSurface,
    cli,
    mcp,
    index
  };
  const resolvedPolicy = decision.normalizePolicy(stage, policyInput, partialStatus);
  const resolvedDecision = decision.resolve(stage, resolvedPolicy, partialStatus, null, null, {
    requireEvidence: options.requireEvidence === true
  });

  return {
    schema: 'specnav.codegraph.status.v1',
    ok: resolvedDecision.result !== 'block',
    generated_at: new Date().toISOString(),
    project_root: projectRoot,
    active_change: options.change || activeChange(projectRoot),
    policy: resolvedPolicy,
    execution_surface: executionSurface,
    decision: {
      stage,
      result: resolvedDecision.result,
      reason: resolvedDecision.explanation
    },
    cli,
    mcp,
    index,
    blockers: resolvedDecision.blockers,
    warnings: resolvedDecision.warnings,
    raw_codegraph_status: statusJson
  };
}

function main(argv = process.argv.slice(2)) {
  if (hasFlag(argv, '--help')) {
    process.stdout.write('Usage: codegraph-status-manager.js [--project <dir>] [--stage <stage>] [--profile <profile>] [--mode <mode>] [--json]\n');
    return 0;
  }
  const result = status({
    projectRoot: argValue(argv, '--project', null),
    stage: argValue(argv, '--stage', 'development'),
    profile: argValue(argv, '--profile', null),
    mode: argValue(argv, '--mode', null),
    requireEvidence: hasFlag(argv, '--require-evidence')
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = {
  MIN_VERSION,
  status,
  main
};
