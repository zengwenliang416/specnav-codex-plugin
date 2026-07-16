#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./specnav-lib');

// Accounting-first policy (0.6): the guard keeps a small set of hard gates
// (truly destructive commands, contract freezes, explicitly admitted
// promoted checks) and downgrades everything else to a non-blocking warning
// plus an auditable event. SPECNAV_STRICT=1 restores blocking behavior for
// the soft gates.
function strictMode() {
  return process.env.SPECNAV_STRICT === '1';
}

function readStdinJson() {
  try {
    const input = fs.readFileSync(0, 'utf8').trim();
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

function toolName(payload) {
  return payload.tool_name || payload.toolName || payload.name || '';
}

// Host contract: `tool_input.file_path`, `tool_input.notebook_path`, and
// `tool_input.command` are the documented-stable payload fields. Everything
// else below is defensive fallback; fallback hits are reported so a host
// payload-shape change surfaces as an event instead of failing silently.
const FALLBACK_PATH_FIELDS = ['path', 'destination_path', 'target_path'];
const NESTED_CONTAINER_FIELDS = ['edits', 'files', 'paths', 'targets'];

function addPath(paths, value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  paths.add(trimmed);
  return true;
}

function collectFallbackPaths(value, paths, fallbackFields, context) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectFallbackPaths(item, paths, fallbackFields, context);
    return;
  }
  const candidates = context.nested
    ? ['file_path', 'notebook_path', ...FALLBACK_PATH_FIELDS]
    : FALLBACK_PATH_FIELDS;
  for (const field of candidates) {
    const before = paths.size;
    if (addPath(paths, value[field]) && paths.size > before) {
      fallbackFields.add(context.nested ? `nested:${field}` : field);
    }
  }
  for (const key of NESTED_CONTAINER_FIELDS) {
    collectFallbackPaths(value[key], paths, fallbackFields, { nested: true });
  }
}

function normalizePayload(payload) {
  const input = payload.tool_input || payload.input || {};
  const paths = new Set();
  const fallbackFields = new Set();
  addPath(paths, input.file_path);
  addPath(paths, input.notebook_path);
  collectFallbackPaths(input, paths, fallbackFields, { nested: false });
  return {
    tool: toolName(payload),
    command: typeof input.command === 'string' ? input.command : '',
    paths: Array.from(paths),
    fallback_fields: Array.from(fallbackFields).sort()
  };
}

function isWriteTool(tool) {
  return /^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(tool || '');
}

function isBashTool(tool) {
  return /^Bash$/i.test(tool || '');
}

function toRelativeProjectPath(root, target) {
  return path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
}

function deny(blockerId, message) {
  const reason = `[${blockerId}] ${message}`;
  // Exit code 2 is the portable blocking contract; the JSON decision below is
  // emitted for hosts that consume structured hook output (stdout is ignored
  // by Claude Code on exit 2, so this is additive).
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  })}\n`);
  console.error(`SpecNav gate denied: ${reason}`);
  process.exit(2);
}

// Warning dedup: the same (reason, change) pair speaks ONCE per session.
// Observed failure mode without this: one missing-tasks warning repeated 154
// times in a single session (~93KB of context) and was tuned out entirely.
// The hook.warn event is still recorded every time for accounting; only the
// model/user-facing systemMessage is deduplicated. Session id comes from the
// hook payload; without one, fall back to the session-lock holder.
function warnDedupFile(root) {
  return path.join(lib.specnavDir(root), 'warned.json');
}

function warnAlreadySent(root, sessionId, reason, change) {
  if (!sessionId) return false;
  const key = `${reason}:${change || ''}`;
  try {
    const state = lib.readJson(warnDedupFile(root), null);
    if (state && state.session_id === sessionId && Array.isArray(state.warned) && state.warned.includes(key)) {
      return true;
    }
    const warned = state && state.session_id === sessionId && Array.isArray(state.warned) ? state.warned : [];
    warned.push(key);
    lib.writeJson(warnDedupFile(root), { session_id: sessionId, warned: warned.slice(-100) });
  } catch {}
  return false;
}

function warn(root, message, reason = 'warn', context = {}) {
  // Non-blocking advisory. Exit 0 + structured JSON is the Claude Code
  // contract for "allow with a message"; exit 1 renders as a hook ERROR
  // banner ("Failed with non-blocking status code") even though nothing is
  // blocked, which reads as breakage to the user. The warning still reaches
  // the model via systemMessage and stays auditable via the hook.warn event.
  lib.event(root, 'hook.warn', { reason, message });
  if (warnAlreadySent(root, context.sessionId, reason, context.change)) {
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify({
    systemMessage: `SpecNav gate warning: ${message}`,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `SpecNav gate warning: ${message}`
    }
  })}\n`);
  process.exit(0);
}

// Soft gate: accounting-first default records a warning and lets the edit
// proceed; SPECNAV_STRICT=1 restores the historical blocking behavior.
function softDeny(root, blockerId, message, context = {}) {
  if (strictMode()) {
    lib.event(root, 'hook.deny', { reason: blockerId });
    deny(blockerId, message);
  }
  warn(root, `[${blockerId}] ${message}`, blockerId, context);
}

// Requirements-stage awareness: while a change has requirements artifacts but
// no tasks.md / light-change.json yet, editing docs and spec material IS the
// legal work of that stage — warning about missing tasks on those paths is
// pure noise. Production-source edits still warn.
const REQUIREMENTS_STAGE_PATHS = [/^docs\//, /^README/i, /\.md$/];

function isRequirementsStageEdit(dir, productionPaths) {
  if (!dir) return false;
  if (!lib.fileExists(path.join(dir, 'requirements.md'))) return false;
  return productionPaths.length > 0 && productionPaths.every(
    (rel) => REQUIREMENTS_STAGE_PATHS.some((pattern) => pattern.test(rel))
  );
}

function allow(root, reason = 'allow') {
  // hook.allow is pure noise at scale (6k+ entries per project); keep the
  // audit trail opt-in. Deny/warn/override events are always recorded.
  if (process.env.SPECNAV_EVENT_VERBOSE === '1') lib.event(root, 'hook.allow', { reason });
  process.exit(0);
}

// Paths owned by the coding harness or the OS, never by project governance:
// Claude/Codex config, plans, memory, and temp directories. A temp prefix is
// only treated as harness-owned when the project itself lives elsewhere —
// otherwise a project rooted under /tmp would lose all sibling-path handling.
function isHarnessPath(absolutePath, projectRootDir) {
  const home = os.homedir();
  const prefixes = [
    path.join(home, '.claude'),
    path.join(home, '.codex'),
    path.join(home, '.config'),
    os.tmpdir(),
    '/tmp',
    '/private/tmp'
  ];
  return prefixes.some((prefix) => {
    if (projectRootDir && isContainedIn(prefix, projectRootDir)) return false;
    const rel = path.relative(prefix, absolutePath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function isContainedIn(rootDir, absolutePath) {
  const rel = path.relative(rootDir, absolutePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Best-effort cross-repo bookkeeping: when this session edits a declared
// external repo that itself has an active SpecNav change with a verify
// report, mark that report stale so the sibling's next verify re-runs.
function touchExternalStale(externalRoot) {
  try {
    const change = lib.activeChange(externalRoot);
    const dir = lib.changeDir(externalRoot, change);
    if (!dir) return;
    if (fs.existsSync(path.join(dir, 'verify-report.json'))) {
      fs.writeFileSync(path.join(dir, 'verify-report.stale'), `${new Date().toISOString()}\n`);
    }
  } catch {}
}

function selfCheck(options = {}) {
  if (process.env.SPECNAV_GUARD_SELFCHECK_FORCE_FAIL === '1') {
    return { ok: false, failures: [{ case: 'forced', reason: 'SPECNAV_GUARD_SELFCHECK_FORCE_FAIL=1' }] };
  }
  const normalize = options.normalize || normalizePayload;
  const cases = [
    {
      name: 'write-file-path',
      payload: { tool_name: 'Write', tool_input: { file_path: 'src/selfcheck.ts', content: 'x' } },
      expect: (result) => result.tool === 'Write' && result.paths.includes('src/selfcheck.ts')
    },
    {
      name: 'bash-command',
      payload: { tool_name: 'Bash', tool_input: { command: 'echo selfcheck' } },
      expect: (result) => result.tool === 'Bash' && result.command === 'echo selfcheck'
    },
    {
      name: 'notebook-path',
      payload: { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'notebooks/selfcheck.ipynb' } },
      expect: (result) => result.tool === 'NotebookEdit' && result.paths.includes('notebooks/selfcheck.ipynb')
    }
  ];
  const failures = [];
  for (const item of cases) {
    let result = null;
    try {
      result = normalize(item.payload);
    } catch (error) {
      failures.push({ case: item.name, reason: `normalize threw: ${error.message}` });
      continue;
    }
    if (!result || !item.expect(result)) {
      failures.push({ case: item.name, reason: 'unexpected normalization result' });
    }
  }
  return { ok: failures.length === 0, failures };
}

function overrideAllows(root, gate, context) {
  const override = lib.findActiveOverride(root, gate, context);
  if (!override) return false;
  lib.event(root, 'hook.override', {
    gate,
    override_file: override.file,
    active_change: context.active_change,
    affected_path: context.affected_path,
    command: context.command
  });
  return true;
}

function pathOverrideAllows(root, gate, rel, activeChange) {
  return overrideAllows(root, gate, {
    active_change: activeChange,
    affected_path: rel
  }) || overrideAllows(root, gate, {
    active_change: activeChange
  });
}

function pathAllowedByScope(scope, rel) {
  const excluded = scope.exclude.some((pattern) => lib.globLikeMatch(pattern, rel));
  if (excluded) return { ok: false, reason: 'excluded' };
  if (!scope.include.length) return { ok: false, reason: 'missing-allowed-roots' };
  const included = scope.include.some((pattern) => lib.globLikeMatch(pattern, rel));
  return { ok: included, reason: included ? 'included' : 'not-included' };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateLightEntryGate(changeDir, activeChange) {
  if (lib.readLane(changeDir).lane !== 'light') return [];
  // Light lane v2: a valid single-file light-change.json satisfies the entry
  // gate on its own; the 14-artifact packet (light-gate.json et al) remains
  // accepted for in-flight changes.
  const lightChange = lib.readLightChange(changeDir);
  if (lightChange.present) {
    if (lightChange.ok && lightChange.value.change_id === activeChange) return [];
    return lightChange.blockers.length ? lightChange.blockers : ['light-change:invalid'];
  }
  const gate = lib.readJson(path.join(changeDir, 'light-gate.json'), null);
  const blockers = [];
  if (!isPlainObject(gate)) return ['light-entry:missing'];
  if (gate.schema_version !== 1) blockers.push('light-entry:invalid-schema');
  if (gate.gate !== 'specnav.light.compactGate.v1') blockers.push('light-entry:invalid-gate');
  if (gate.change_id !== activeChange) blockers.push('light-entry:change-mismatch');
  if (gate.lane !== 'light') blockers.push('light-entry:lane-mismatch');
  if (!isPlainObject(gate.entry)) {
    blockers.push('light-entry:missing-entry');
  } else {
    if (gate.entry.status !== 'ready') blockers.push('light-entry:not-ready');
    if (!Array.isArray(gate.entry.editable_paths) || gate.entry.editable_paths.length === 0) {
      blockers.push('light-entry:paths-missing');
    }
    if (gate.entry.scope !== 'scope.json') blockers.push('light-entry:scope-missing');
    if (gate.entry.tasks !== 'tasks.md') blockers.push('light-entry:tasks-missing');
  }
  if (!isPlainObject(gate.test)) blockers.push('light-test:missing-gate');
  if (!isPlainObject(gate.archive)) blockers.push('light-archive:missing-gate');
  return Array.from(new Set(blockers));
}

function collectFrozenTestPaths(changeDir) {
  // TDD tamper-guard: task context.json may declare test_paths. A test file
  // may be created once (tests-first), but modifying an existing test during
  // implementation requires an explicit frozen-tests override.
  const patterns = [];
  const tasksDir = path.join(changeDir, 'development', 'tasks');
  let taskIds = [];
  try {
    taskIds = fs.readdirSync(tasksDir);
  } catch {
    return patterns;
  }
  for (const taskId of taskIds) {
    const context = lib.readJson(path.join(tasksDir, taskId, 'context.json'), null);
    if (!context || !Array.isArray(context.test_paths)) continue;
    for (const pattern of context.test_paths) {
      if (typeof pattern === 'string' && pattern.trim()) patterns.push(pattern.trim());
    }
  }
  return patterns;
}

function collectPromotedCheckRules(root) {
  // Act->capability enforcement. Reads admitted promoted-check rule files. A rule
  // is enforced ONLY when it declares enforcement:"gate" (a deliberate opt-in);
  // advisory rules are ignored here. Mirrors the frozen-tests data-declared model.
  const dir = path.join(root, 'openspec', 'knowledge', 'promoted-checks');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  const rules = [];
  for (const file of files) {
    const rule = lib.readJson(path.join(dir, file), null);
    if (!rule || rule.schema !== 'specnav.knowledge.promotedCheck.v1') continue;
    if (rule.enforcement !== 'gate') continue;
    const globs = Array.isArray(rule.deny_globs) ? rule.deny_globs.filter((glob) => typeof glob === 'string' && glob.trim()) : [];
    if (!globs.length || typeof rule.id !== 'string' || !rule.id.trim()) continue;
    rules.push({ id: rule.id.trim(), deny_globs: globs, reason: typeof rule.reason === 'string' ? rule.reason : '' });
  }
  return rules;
}

function isOpenSpecRepairCommand(command) {
  if (!command) return false;
  return /\bopenspec\b.*\b(init|validate|status)\b/.test(command)
    || /\bspecnav-(bootstrap|status|doctor)\b/.test(command)
    || /\bnode\b.*\b(specnav-bootstrap|specnav-doctor|workflow-state|affordances|plugin-suite)\.js\b/.test(command);
}

function isLegacyOpenSpecWorkflowCommand(command) {
  if (!command) return false;
  // Only match actual invocations in command position (start of a shell
  // segment). Matching anywhere in the string flagged commit messages and
  // heredoc bodies that merely mention "OpenSpec propose" (observed misfires).
  const segments = String(command).split(/(?:^|&&|\|\||[;|\n])\s*/);
  return segments.some((raw) => {
    const segment = raw.trim();
    return /^openspec\s+(propose|proposal|apply|implement)\b/i.test(segment)
      || /^opsx\s*[:/]\s*(propose|apply|explore|archive)\b/i.test(segment)
      || /^\/?openspec-(propose|apply|explore|archive)\b/i.test(segment);
  });
}

// Hard-deny only the precisely destructive shapes. `rm -rf` on a project
// subdirectory or /tmp is routine cleanup and must not be blocked (observed
// misfires: `rm -rf .next`, `rm -rf /tmp/codex-A`).
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(?:--\s+)?(?:"\/"|'\/'|\/|\/\*|~|~\/|\$HOME\b)\s*(?:$|[;&|])/,
  /\bsudo\s+rm\b/,
  /\bmkfs(?:\.|\b)/,
  /\bdd\s+if=[^\s]+\s+of=\/dev\//,
  /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sh|bash|zsh)\b/
];

function isDangerousCommand(command) {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function main() {
  const root = lib.projectRoot();
  const payload = readStdinJson();
  const normalized = normalizePayload(payload);
  const sessionId = typeof payload.session_id === 'string' && payload.session_id
    ? payload.session_id
    : (process.env.CLAUDE_SESSION_ID || null);
  if (normalized.fallback_fields.length) {
    lib.event(root, 'guard.unknown-payload-shape', {
      tool: normalized.tool,
      fallback_fields: normalized.fallback_fields
    });
  }
  if (normalized.command && isDangerousCommand(normalized.command)) {
    if (overrideAllows(root, 'dangerous-command', { command: normalized.command })) {
      allow(root, 'override-dangerous-command');
    }
    lib.event(root, 'hook.deny', { reason: 'dangerous-command', command: normalized.command.slice(0, 200) });
    deny('dangerous-command', 'dangerous shell command requires explicit manual review. Fix: run it manually outside the agent, or create a dangerous-command override with a reason.');
  }
  if (lib.isSpecNavProject(root) && isBashTool(normalized.tool) && isLegacyOpenSpecWorkflowCommand(normalized.command)) {
    softDeny(root, 'legacy-openspec-workflow-command', 'native OpenSpec workflow entrypoints are disabled inside SpecNav projects. Fix: use SpecNav requirements/prototype/development/verification/operations commands instead.');
  }

  // Split targets: absolute/`../` paths that resolve outside the project are
  // governed by the external-path policy (harness allowlist + declared
  // external repos), never by in-project scope globs.
  const externalAbsPaths = [];
  const relPaths = [];
  for (const target of normalized.paths) {
    const absolute = path.resolve(root, target);
    if (isContainedIn(root, absolute)) relPaths.push(toRelativeProjectPath(root, absolute));
    else externalAbsPaths.push(absolute);
  }
  const productionPaths = relPaths.filter((rel) => !rel.startsWith('openspec/'));
  const hasOpenSpec = fs.existsSync(lib.openspecDir(root));
  const legacyEntrypoints = hasOpenSpec ? lib.detectLegacyOpenSpecEntrypoints(root) : [];

  // Harness-owned paths (Claude/Codex config, plans, memory, tmp) are always
  // out of project governance — resolve them before any project gate.
  const externalPending = externalAbsPaths.filter((absolute) => !isHarnessPath(absolute, root));

  if (!hasOpenSpec) {
    if (!lib.isSpecNavProject(root)) {
      allow(root, 'non-specnav-project');
    }
    const openspecRepairPaths = normalized.paths.length > 0 && productionPaths.length === 0 && externalPending.length === 0;
    if (openspecRepairPaths) allow(root, 'openspec-repair-without-openspec');
    if (isBashTool(normalized.tool) && isOpenSpecRepairCommand(normalized.command)) {
      allow(root, 'openspec-command-without-openspec');
    }
    softDeny(root, 'missing-openspec', 'missing openspec/ blocks production work. Fix: use $specnav-bootstrap to initialize or repair OpenSpec first.', { sessionId });
  }

  if (!normalized.paths.length) {
    if (isWriteTool(normalized.tool)) {
      warn(root, `No target path found in ${normalized.tool || 'write'} hook payload.`);
    }
    allow(root, 'no-target-path');
  }

  const changeState = lib.activeChangeState(root);
  const change = changeState.change;
  const dir = lib.changeDir(root, change);

  // External (cross-repo) targets: allowed when declared in scope.json
  // external_repos; undeclared targets collect into a soft gate flushed after
  // the in-project hard gates (so an external miss never short-circuits a
  // frozen-acceptance / promoted-check deny on the same tool call).
  const externalViolations = [];
  if (externalPending.length) {
    const scopeForExternal = dir ? lib.readFileScope(dir) : { externalRepos: [] };
    const declaredRepos = Array.isArray(scopeForExternal.externalRepos) ? scopeForExternal.externalRepos : [];
    for (const absolute of externalPending) {
      const repo = declaredRepos.find((entry) => isContainedIn(entry.root, absolute));
      if (repo) {
        const relInRepo = path.relative(repo.root, absolute).split(path.sep).join('/');
        const excluded = repo.exclude.some((pattern) => lib.globLikeMatch(pattern, relInRepo));
        const included = !excluded && repo.include.some((pattern) => lib.globLikeMatch(pattern, relInRepo));
        if (included) {
          lib.event(root, 'hook.external-edit', {
            external_root: repo.root,
            path: relInRepo,
            active_change: change,
            reason: repo.reason
          });
          touchExternalStale(repo.root);
          continue;
        }
      }
      if (pathOverrideAllows(root, 'external-scope', absolute, change)) continue;
      externalViolations.push(absolute);
    }
  }

  function flushExternalViolations() {
    if (!externalViolations.length) return;
    softDeny(root, 'external-scope', `${externalViolations.join(', ')} outside this project and not declared in scope.json external_repos. Fix: add {"root": "../<repo>", "include": ["<glob>"], "reason": "..."} to external_repos for change ${change || '<active>'}, or create an external-scope override.`, { sessionId, change });
  }

  if (!productionPaths.length) {
    flushExternalViolations();
    allow(root, 'openspec-edit');
  }
  if (legacyEntrypoints.length) {
    softDeny(root, 'legacy-openspec-workflow', `legacy OpenSpec workflow entrypoints are present: ${legacyEntrypoints.map((entry) => entry.name).join(', ')}. Fix: disable them or replace them with SpecNav disabled stubs before production edits.`, { sessionId });
  }
  if (!change || !dir) {
    const blockers = changeState.blockers && changeState.blockers.length ? changeState.blockers : ['active-change'];
    softDeny(root, blockers[0], `production edits require an explicit SpecNav change (${blockers.join(', ')}). Fix: set SPECNAV_CHANGE or repair openspec/.specnav/change-registry.json.`, { sessionId });
  }

  const lightChange = lib.readLightChange(dir);
  if (!lib.fileExists(path.join(dir, 'tasks.md')) && !(lightChange.present && lightChange.ok)) {
    const overridden = productionPaths.every((rel) => pathOverrideAllows(root, 'missing-tasks', rel, change));
    if (overridden) {
      allow(root, 'override-missing-tasks');
    }
    // Requirements-stage edits (docs, specs, markdown) are the legal work of
    // a change that has requirements.md but no tasks yet — stay silent.
    if (isRequirementsStageEdit(dir, productionPaths)) {
      allow(root, 'requirements-stage-doc-edit');
    }
    softDeny(root, 'missing-tasks', 'production edits require an active OpenSpec change with tasks.md (or a light-change.json). Fix: create tasks.md for the active change before editing production files.', { sessionId, change });
  }

  const lightGateBlockers = validateLightEntryGate(dir, change);
  if (lightGateBlockers.length) {
    softDeny(root, lightGateBlockers[0], `light lane production edits require a valid light-change.json or light-gate.json (${lightGateBlockers.join(', ')}). Fix: use the specnav-light-change skill to create the compact entry gate before implementation.`, { sessionId, change });
  }

  const scope = lib.readFileScope(dir);
  if (!scope.ok) {
    softDeny(root, 'invalid-scope', `production edits require a valid scope.json (${(scope.blockers || []).join(', ') || 'invalid-scope'}). Fix: repair ${scope.source} for the active change.`, { sessionId, change });
  }

  const frozenTestPaths = collectFrozenTestPaths(dir);
  const promotedCheckRules = collectPromotedCheckRules(root);
  const reviewHits = [];
  const softScopeHits = [];
  for (const rel of productionPaths) {
    // Hard gates: contract freezes and explicitly admitted promoted checks.
    if (/^tests\/acceptance\//.test(rel)) {
      if (pathOverrideAllows(root, 'frozen-acceptance', rel, change)) continue;
      lib.event(root, 'hook.deny', { reason: 'frozen-acceptance', path: rel });
      deny('frozen-acceptance', `acceptance contract is frozen during implementation: ${rel}. Fix: create a frozen-acceptance override with a reason if the contract itself must change.`);
    }
    if (frozenTestPaths.some((pattern) => lib.globLikeMatch(pattern, rel)) && fs.existsSync(path.resolve(root, rel))) {
      if (!pathOverrideAllows(root, 'frozen-tests', rel, change)) {
        lib.event(root, 'hook.deny', { reason: 'frozen-tests', path: rel });
        deny('frozen-tests', `${rel} is a committed task test (context.json test_paths) and is frozen during implementation. Fix: create a frozen-tests override with a reason if the test itself must change.`);
      }
      continue;
    }
    for (const rule of promotedCheckRules) {
      if (rule.deny_globs.some((pattern) => lib.globLikeMatch(pattern, rel))) {
        if (pathOverrideAllows(root, 'promoted-check', rel, change)) continue;
        lib.event(root, 'hook.deny', { reason: `promoted-check:${rule.id}`, path: rel, rule: rule.id });
        deny(`promoted-check:${rule.id}`, `${rel} matches admitted promoted check ${rule.id}${rule.reason ? ` (${rule.reason})` : ''}. Fix: address the checked risk, or create a promoted-check override with a reason.`);
      }
    }
    // Soft gates: scope and operation drift are recorded and surfaced, not blocked.
    const scopeResult = pathAllowedByScope(scope, rel);
    if (!scopeResult.ok) {
      if (!pathOverrideAllows(root, 'scope', rel, change)) {
        lib.event(root, 'hook.scope-drift', {
          scope_reason: scopeResult.reason,
          path: rel,
          include: scope.include,
          scope_source: scope.source,
          active_change: change
        });
        softScopeHits.push(rel);
      }
    }
    if (scope.operations) {
      const operation = fs.existsSync(path.resolve(root, rel)) ? 'modify' : 'create';
      if (scope.operations[operation] === false && !pathOverrideAllows(root, 'operation', rel, change)) {
        softDeny(root, 'operation', `${operation} of ${rel} is blocked by scope.json allowed_operations. Fix: enable the operation in scope.json or create an operation override.`);
      }
    }
    if (Array.isArray(scope.reviewRequired) && scope.reviewRequired.some((pattern) => lib.globLikeMatch(pattern, rel))) {
      reviewHits.push(rel);
    }
  }

  flushExternalViolations();

  if (softScopeHits.length) {
    softDeny(root, 'scope', `${softScopeHits.join(', ')} outside declared SpecNav file scope from ${scope.source} (allowed: ${scope.include.join(', ') || 'none'}). Recorded as scope drift; extend scope.json allowed_roots or add a scope override to silence this. (This warning appears once per session; further drift is recorded in events.jsonl.)`, { sessionId, change });
  }

  if (reviewHits.length && !reviewHits.every((rel) => pathOverrideAllows(root, 'review', rel, change))) {
    warn(root, `${reviewHits.join(', ')} match requires_review_on; escalate review (shared/dependency/migration) then add a review override.`, 'requires-review');
  }

  allow(root, 'within-scope');
}

if (require.main === module) main();

module.exports = {
  collectFallbackPaths,
  normalizePayload,
  pathAllowedByScope,
  selfCheck,
  toRelativeProjectPath
};
