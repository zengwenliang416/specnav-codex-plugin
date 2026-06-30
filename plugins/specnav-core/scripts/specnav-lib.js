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

function changeRegistryFile(root) {
  return path.join(specnavDir(root), 'change-registry.json');
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

function listChangeIds(root) {
  return listDirs(path.join(openspecDir(root), 'changes'))
    .map((entry) => path.basename(entry))
    .filter((name) => name !== 'archive' && !name.startsWith('.'))
    .map((name) => cleanChangeValue(name))
    .filter(Boolean)
    .sort();
}

function inferChangeStage(root, change) {
  const dir = path.join(openspecDir(root), 'changes', change);
  if (fs.existsSync(path.join(dir, 'operations', 'readiness.json'))) return 'operations';
  if (fs.existsSync(path.join(dir, 'verify', 'aggregate-report.json')) || fs.existsSync(path.join(dir, 'verify-report.json'))) return 'verification';
  if (fs.existsSync(path.join(dir, 'development'))) return 'development';
  if (fs.existsSync(path.join(dir, 'prototype'))) return 'prototype';
  if (fs.existsSync(path.join(dir, 'requirements.md')) || fs.existsSync(path.join(dir, 'acceptance.md'))) return 'requirements';
  if (fs.existsSync(path.join(dir, 'proposal.md')) || fs.existsSync(path.join(dir, 'design.md')) || fs.existsSync(path.join(dir, 'tasks.md'))) return 'openspec-artifacts';
  return 'created';
}

function buildChangeRegistry(root) {
  const file = changeRegistryFile(root);
  const stored = readJson(file, {});
  const existing = new Set(listChangeIds(root));
  const changes = new Map();
  const archiveRoot = path.resolve(openspecDir(root), 'changes', 'archive');

  function safeArchivePath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const relative = value.trim();
    if (path.isAbsolute(relative) || relative.split(/[\\/]+/).includes('..')) return null;
    const absolute = path.resolve(root, relative);
    if (absolute !== archiveRoot && !absolute.startsWith(`${archiveRoot}${path.sep}`)) return null;
    return fs.existsSync(absolute) ? relative.split(path.sep).join('/') : null;
  }

  if (stored && typeof stored === 'object' && Array.isArray(stored.changes)) {
    for (const item of stored.changes) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const id = cleanChangeValue(item.id || item.change_id);
      const archivePath = safeArchivePath(item.archive_path);
      const archived = item.status === 'archived' || item.stage === 'archived';
      if (!id || (!existing.has(id) && !(archived && archivePath))) continue;
      changes.set(id, {
        id,
        stage: existing.has(id)
          ? (typeof item.stage === 'string' && item.stage.trim() && item.stage !== 'archived' ? item.stage : inferChangeStage(root, id))
          : 'archived',
        status: existing.has(id)
          ? (typeof item.status === 'string' && item.status.trim() && item.status !== 'archived' ? item.status : 'active')
          : 'archived',
        branch: typeof item.branch === 'string' ? item.branch : null,
        created_at: typeof item.created_at === 'string' ? item.created_at : null,
        last_active_at: typeof item.last_active_at === 'string' ? item.last_active_at : null,
        ...(archivePath ? { archive_path: archivePath } : {}),
        ...(typeof item.archived_at === 'string' ? { archived_at: item.archived_at } : {})
      });
    }
  }

  for (const id of existing) {
    if (changes.has(id)) continue;
    changes.set(id, {
      id,
      stage: inferChangeStage(root, id),
      status: 'active',
      branch: null,
      created_at: null,
      last_active_at: null
    });
  }

  const storedFocus = cleanChangeValue(stored && (stored.current_focus || stored.active_focus));
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    current_focus: storedFocus && existing.has(storedFocus) && changes.has(storedFocus) ? storedFocus : null,
    changes: Array.from(changes.values()).sort((a, b) => a.id.localeCompare(b.id))
  };
}

function writeChangeRegistry(root, registry) {
  writeJson(changeRegistryFile(root), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    current_focus: registry.current_focus || null,
    changes: registry.changes || []
  });
}

function changeExists(root, change) {
  return !!change && listChangeIds(root).includes(change);
}

function activeChangeState(root, options = {}) {
  const changes = listChangeIds(root);
  const candidates = changes.slice();
  const requested = Object.prototype.hasOwnProperty.call(options, 'change')
    ? options.change
    : (Object.prototype.hasOwnProperty.call(process.env, 'SPECNAV_CHANGE') ? process.env.SPECNAV_CHANGE : undefined);

  if (requested !== undefined) {
    const change = cleanChangeValue(requested);
    if (!change || !changes.includes(change)) {
      return {
        change: null,
        source: 'explicit',
        blockers: ['active-change'],
        candidates,
        registry: buildChangeRegistry(root)
      };
    }
    return {
      change,
      source: Object.prototype.hasOwnProperty.call(options, 'change') ? 'argument' : 'env',
      blockers: [],
      candidates,
      registry: buildChangeRegistry(root)
    };
  }

  const explicit = readActiveChangeFile(root);
  if (explicit.present) {
    if (explicit.change && changes.includes(explicit.change)) {
      return {
        change: explicit.change,
        source: 'active-change-file',
        blockers: [],
        candidates,
        registry: buildChangeRegistry(root)
      };
    }
    return {
      change: null,
      source: 'active-change-file',
      blockers: ['active-change'],
      candidates,
      registry: buildChangeRegistry(root)
    };
  }

  const registry = buildChangeRegistry(root);
  if (registry.current_focus) {
    return {
      change: registry.current_focus,
      source: 'change-registry',
      blockers: [],
      candidates,
      registry
    };
  }

  if (changes.length === 1) {
    return {
      change: changes[0],
      source: 'single-change',
      blockers: [],
      candidates,
      registry
    };
  }

  const workflowState = readWorkflowStateActiveChange(root);
  if (changes.length === 0 && workflowState.hasValue && workflowState.change) {
    return {
      change: null,
      source: 'workflow-state-cache',
      blockers: ['active-change'],
      candidates,
      registry
    };
  }

  if (changes.length > 1) {
    return {
      change: null,
      source: 'ambiguous',
      blockers: ['ambiguous-change'],
      candidates,
      registry
    };
  }

  return {
    change: null,
    source: 'no-active-change',
    blockers: ['active-change'],
    candidates,
    registry
  };
}

function activeChange(root) {
  return activeChangeState(root).change;
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

function detectLegacyOpenSpecEntrypoints(root) {
  const entries = [];
  const skillsDir = path.join(root, '.claude', 'skills');
  const commandsDir = path.join(root, '.claude', 'commands', 'opsx');
  const isSpecNavDisabledStub = (file) => {
    const text = readText(file);
    return /\blegacy-openspec-workflow\b/.test(text)
      && /\bSpecNav\b/.test(text)
      && /\bDisabled\b/i.test(text);
  };

  try {
    for (const name of fs.readdirSync(skillsDir)) {
      const skillFile = path.join(skillsDir, name, 'SKILL.md');
      if (!name.startsWith('openspec-') || !fs.existsSync(skillFile)) continue;
      if (isSpecNavDisabledStub(skillFile)) continue;
      entries.push({
        type: 'skill',
        name,
        path: path.relative(root, skillFile).split(path.sep).join('/'),
        blocker: `legacy-openspec-skill:${name}`
      });
    }
  } catch {
    // Project has no local OpenSpec skills.
  }

  try {
    for (const name of fs.readdirSync(commandsDir)) {
      const commandFile = path.join(commandsDir, name);
      if (!name.endsWith('.md') || !fs.existsSync(commandFile)) continue;
      if (isSpecNavDisabledStub(commandFile)) continue;
      const commandName = `opsx/${name.replace(/\.md$/, '')}`;
      entries.push({
        type: 'command',
        name: commandName,
        path: path.relative(root, commandFile).split(path.sep).join('/'),
        blocker: `legacy-opsx-command:${commandName}`
      });
    }
  } catch {
    // Project has no local OPSX commands.
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

module.exports = {
  activeChange,
  activeChangeState,
  buildChangeRegistry,
  changeDir,
  changeExists,
  changeRegistryFile,
  detectLegacyOpenSpecEntrypoints,
  ensureDir,
  ensureSpecNavMarker,
  event,
  fileExists,
  findActiveOverride,
  globLikeMatch,
  specnavDir,
  specnavMarkerFile,
  isSpecNavProject,
  listChangeIds,
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
  writeChangeRegistry,
  writeJson
};
