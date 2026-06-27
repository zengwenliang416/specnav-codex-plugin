#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function projectRoot(argv = process.argv) {
  const positional = argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const explicit = positional.find((arg) => fs.existsSync(arg) && fs.statSync(arg).isDirectory());
  return path.resolve(process.env.PROJECT_DIR || explicit || process.env.PWD || process.cwd());
}

function openspecDir(root) {
  return path.join(root, 'openspec');
}

function specnavDir(root) {
  return path.join(openspecDir(root), '.specnav');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir)
      .map((name) => path.join(dir, name))
      .filter((entry) => fs.statSync(entry).isDirectory());
  } catch {
    return [];
  }
}

function invalidChangeId(value) {
  if (!value || value === '.' || value === '..') return true;
  return value.includes('/') || value.includes('\\') || value.includes('..') || /\s/.test(value);
}

function cleanChangeValue(value) {
  if (typeof value !== 'string') return null;
  if (value !== value.trim()) return null;
  const change = value.trim();
  return invalidChangeId(change) ? null : change;
}

function readActiveChangeFile(root) {
  const activeFile = path.join(specnavDir(root), 'active-change');
  try {
    if (!fs.statSync(activeFile).isFile()) return { present: true, change: null };
  } catch (error) {
    return { present: !!(error && error.code !== 'ENOENT'), change: null };
  }

  let content;
  try {
    content = fs.readFileSync(activeFile, 'utf8');
  } catch {
    return { present: true, change: null };
  }
  const withoutSingleFinalNewline = content.replace(/\r?\n$/, '');
  if (withoutSingleFinalNewline !== content.trim()) return { present: true, change: null };
  return { present: true, change: cleanChangeValue(withoutSingleFinalNewline) };
}

function readWorkflowStateActiveChange(root) {
  const stateFile = path.join(specnavDir(root), 'workflow-state.json');
  try {
    if (!fs.statSync(stateFile).isFile()) return { present: true, hasValue: true, change: null };
  } catch (error) {
    return { present: !!(error && error.code !== 'ENOENT'), hasValue: false, change: null };
  }

  let workflowState;
  try {
    workflowState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { present: true, hasValue: true, change: null };
  }

  if (!workflowState || typeof workflowState !== 'object' || Array.isArray(workflowState)) {
    return { present: true, hasValue: true, change: null };
  }
  if (!Object.prototype.hasOwnProperty.call(workflowState, 'active_change')) {
    return { present: true, hasValue: false, change: null };
  }
  if (workflowState.active_change === null || workflowState.active_change === undefined) {
    return { present: true, hasValue: false, change: null };
  }
  return { present: true, hasValue: true, change: cleanChangeValue(workflowState.active_change) };
}

function activeChange(root) {
  if (Object.prototype.hasOwnProperty.call(process.env, 'SPECNAV_CHANGE')) {
    return cleanChangeValue(process.env.SPECNAV_CHANGE);
  }

  const explicit = readActiveChangeFile(root);
  if (explicit.present) return explicit.change;

  const changes = listDirs(path.join(openspecDir(root), 'changes'));
  if (changes.length === 1) return cleanChangeValue(path.basename(changes[0]));

  const workflowState = readWorkflowStateActiveChange(root);
  if (workflowState.hasValue) return workflowState.change;

  return null;
}

function changeDir(root, change = activeChange(root)) {
  return change ? path.join(openspecDir(root), 'changes', change) : null;
}

function fileExists(file) {
  return !!file && fs.existsSync(file);
}

function parseScope(designText) {
  const lines = designText.split(/\r?\n/);
  const scopes = [];
  let inScope = false;
  for (const line of lines) {
    if (/^##+\s+file scope\s*$/i.test(line.trim())) {
      inScope = true;
      continue;
    }
    if (inScope && /^##+\s+/.test(line)) break;
    if (inScope) {
      const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
      if (match) scopes.push(match[1].replace(/`/g, '').trim());
    }
  }
  return scopes;
}

function readFileScope(changeDir) {
  const scopeFile = path.join(changeDir, 'scope.json');
  let jsonScope = null;
  try {
    jsonScope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      source: 'scope.json',
      include: [],
      exclude: [],
      blockers: [error && error instanceof SyntaxError ? 'invalid-scope-json' : 'missing-scope-json']
    };
  }

  if (!jsonScope || typeof jsonScope !== 'object' || Array.isArray(jsonScope)) {
    return {
      ok: false,
      source: 'scope.json',
      include: [],
      exclude: [],
      blockers: ['invalid-scope-shape']
    };
  }

  const include = Array.isArray(jsonScope.allowed_roots)
    ? jsonScope.allowed_roots.filter(Boolean)
    : Array.isArray(jsonScope.include)
      ? jsonScope.include.filter(Boolean)
      : [];
  const exclude = Array.isArray(jsonScope.denied_roots)
    ? jsonScope.denied_roots.filter(Boolean)
    : Array.isArray(jsonScope.exclude)
      ? jsonScope.exclude.filter(Boolean)
      : [];
  const blockers = [];
  if (!include.length) blockers.push('missing-scope-allowed-roots');
  if (Object.prototype.hasOwnProperty.call(jsonScope, 'allowed_roots') && !Array.isArray(jsonScope.allowed_roots)) {
    blockers.push('invalid-scope-allowed-roots');
  }
  if (Object.prototype.hasOwnProperty.call(jsonScope, 'denied_roots') && !Array.isArray(jsonScope.denied_roots)) {
    blockers.push('invalid-scope-denied-roots');
  }

  const operations = (jsonScope.allowed_operations && typeof jsonScope.allowed_operations === 'object' && !Array.isArray(jsonScope.allowed_operations))
    ? jsonScope.allowed_operations
    : null;
  const reviewRequired = Array.isArray(jsonScope.requires_review_on)
    ? jsonScope.requires_review_on.filter((value) => typeof value === 'string' && value.trim())
    : [];

  return {
    ok: blockers.length === 0,
    source: 'scope.json',
    include,
    exclude,
    operations,
    reviewRequired,
    blockers
  };
}

function globLikeMatch(pattern, relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalized) || normalized.startsWith(pattern.replace(/\*\*$/, ''));
}

function event(root, type, payload = {}) {
  if (!fs.existsSync(openspecDir(root))) return;
  const entry = {
    ts: new Date().toISOString(),
    type,
    payload
  };
  const file = path.join(specnavDir(root), 'events.jsonl');
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function overridesDir(root) {
  return path.join(specnavDir(root), 'overrides');
}

function listOverrides(root) {
  const dir = overridesDir(root);
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(dir, name))
      .map((file) => ({ file, data: readJson(file, null) }))
      .filter((entry) => entry.data && typeof entry.data === 'object');
  } catch {
    return [];
  }
}

function matchesOverrideValue(expected, actual) {
  if (!expected) return true;
  if (!actual) return false;
  return expected === actual;
}

function findActiveOverride(root, gate, context = {}) {
  const now = Date.now();
  const change = context.active_change || activeChange(root);
  for (const entry of listOverrides(root)) {
    const item = entry.data;
    if (item.gate !== gate) continue;
    if (item.expires_at && Date.parse(item.expires_at) <= now) continue;
    if (item.active_change && item.active_change !== change) continue;
    if (!matchesOverrideValue(item.affected_path, context.affected_path)) continue;
    if (!matchesOverrideValue(item.command, context.command)) continue;
    return { ...item, file: entry.file };
  }
  return null;
}

function runCommand(command, options = {}) {
  const startedAt = Date.now();
  try {
    const result = childProcess.spawnSync(command, {
      shell: true,
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      timeout: options.timeoutMs || 120000,
      maxBuffer: 1024 * 1024 * 10
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      duration_ms: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: error.message,
      duration_ms: Date.now() - startedAt
    };
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function openspecStatus(root, change) {
  if (process.env.SPECNAV_DISABLE_OPENSPEC === '1') return { ok: false, error: 'disabled' };
  if (!change) return { ok: false, error: 'no-change' };
  const result = runCommand(`openspec --no-color status --change ${shellQuote(change)} --json`, {
    cwd: root,
    timeoutMs: 30000
  });
  const parsed = extractFirstJsonObject(`${result.stdout}\n${result.stderr}`);
  if (!result.ok || !parsed) {
    return {
      ok: false,
      status: result.status,
      error: parsed ? result.stderr : 'json-parse-failed',
      stdout_tail: result.stdout.slice(-1000),
      stderr_tail: result.stderr.slice(-1000)
    };
  }
  return {
    ok: true,
    status: parsed
  };
}

function specnavMarkerFile(root) {
  return path.join(root, '.specnav.json');
}

function isSpecNavProject(root) {
  return fs.existsSync(specnavMarkerFile(root)) || fs.existsSync(openspecDir(root));
}

function ensureSpecNavMarker(root) {
  const file = specnavMarkerFile(root);
  if (fs.existsSync(file)) return false;
  writeJson(file, {
    schema_version: 1,
    enabled: true,
    created_at: new Date().toISOString()
  });
  return true;
}

module.exports = {
  activeChange,
  changeDir,
  ensureDir,
  ensureSpecNavMarker,
  event,
  fileExists,
  findActiveOverride,
  globLikeMatch,
  specnavDir,
  specnavMarkerFile,
  isSpecNavProject,
  listDirs,
  listOverrides,
  openspecDir,
  openspecStatus,
  overridesDir,
  parseScope,
  projectRoot,
  readFileScope,
  readJson,
  readText,
  runCommand,
  shellQuote,
  writeJson
};
