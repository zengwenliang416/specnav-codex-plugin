#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');

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

function warn(root, message) {
  // Non-blocking advisory. Exit 0 + structured JSON is the Claude Code
  // contract for "allow with a message"; exit 1 renders as a hook ERROR
  // banner ("Failed with non-blocking status code") even though nothing is
  // blocked, which reads as breakage to the user. The warning still reaches
  // the model via systemMessage and stays auditable via the hook.warn event.
  lib.event(root, 'hook.warn', { message });
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

function allow(root, reason = 'allow') {
  lib.event(root, 'hook.allow', { reason });
  process.exit(0);
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
  const normalized = command.replace(/\s+/g, ' ').trim();
  return /\bopenspec\b.*\b(propose|proposal|apply|implement)\b/i.test(normalized)
    || /\bopsx\s*[:/]\s*(propose|apply|explore|archive)\b/i.test(normalized)
    || /\b(?:\/)?openspec-(propose|apply|explore|archive)\b/i.test(normalized);
}

function main() {
  const root = lib.projectRoot();
  const payload = readStdinJson();
  const normalized = normalizePayload(payload);
  if (normalized.fallback_fields.length) {
    lib.event(root, 'guard.unknown-payload-shape', {
      tool: normalized.tool,
      fallback_fields: normalized.fallback_fields
    });
  }
  if (normalized.command && /\brm\s+-rf\s+\/|\bsudo\b|curl\b.+\|\s*(sh|bash)|wget\b.+\|\s*(sh|bash)/.test(normalized.command)) {
    if (overrideAllows(root, 'dangerous-command', { command: normalized.command })) {
      allow(root, 'override-dangerous-command');
    }
    lib.event(root, 'hook.deny', { reason: 'dangerous-command' });
    deny('dangerous-command', 'dangerous shell command requires explicit manual review. Fix: run it manually outside the agent, or create a dangerous-command override with a reason.');
  }
  if (lib.isSpecNavProject(root) && isBashTool(normalized.tool) && isLegacyOpenSpecWorkflowCommand(normalized.command)) {
    lib.event(root, 'hook.deny', { reason: 'legacy-openspec-workflow-command', command: normalized.command });
    deny('legacy-openspec-workflow-command', 'native OpenSpec workflow entrypoints are disabled inside SpecNav projects. Fix: use SpecNav requirements/prototype/development/verification/operations commands instead.');
  }

  const relPaths = normalized.paths.map((target) => toRelativeProjectPath(root, target));
  const productionPaths = relPaths.filter((rel) => !rel.startsWith('openspec/'));
  const hasOpenSpec = fs.existsSync(lib.openspecDir(root));
  const legacyEntrypoints = hasOpenSpec ? lib.detectLegacyOpenSpecEntrypoints(root) : [];

  if (!hasOpenSpec) {
    if (!lib.isSpecNavProject(root)) {
      allow(root, 'non-specnav-project');
    }
    const openspecRepairPaths = relPaths.length > 0 && productionPaths.length === 0;
    if (openspecRepairPaths) allow(root, 'openspec-repair-without-openspec');
    if (isBashTool(normalized.tool) && isOpenSpecRepairCommand(normalized.command)) {
      allow(root, 'openspec-command-without-openspec');
    }
    lib.event(root, 'hook.deny', { reason: 'missing-openspec', paths: productionPaths, command: normalized.command });
    deny('missing-openspec', 'missing openspec/ blocks production work. Fix: use $specnav-bootstrap to initialize or repair OpenSpec first.');
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
  if (!productionPaths.length) allow(root, 'openspec-edit');
  if (legacyEntrypoints.length) {
    lib.event(root, 'hook.deny', {
      reason: 'legacy-openspec-workflow',
      paths: productionPaths,
      legacy_entrypoints: legacyEntrypoints
    });
    deny('legacy-openspec-workflow', `legacy OpenSpec workflow entrypoints are present: ${legacyEntrypoints.map((entry) => entry.name).join(', ')}. Fix: disable them or replace them with SpecNav disabled stubs before production edits.`);
  }
  if (!change || !dir) {
    const blockers = changeState.blockers && changeState.blockers.length ? changeState.blockers : ['active-change'];
    lib.event(root, 'hook.deny', { reason: blockers[0], paths: productionPaths, candidates: changeState.candidates || [] });
    deny(blockers[0], `production edits require an explicit SpecNav change (${blockers.join(', ')}). Fix: set SPECNAV_CHANGE or repair openspec/.specnav/change-registry.json.`);
  }

  if (!lib.fileExists(path.join(dir, 'tasks.md'))) {
    const overridden = productionPaths.every((rel) => pathOverrideAllows(root, 'missing-tasks', rel, change));
    if (overridden) {
      allow(root, 'override-missing-tasks');
    }
    lib.event(root, 'hook.deny', { reason: 'missing-tasks', paths: productionPaths });
    deny('missing-tasks', 'production edits require an active OpenSpec change with tasks.md. Fix: create tasks.md for the active change before editing production files.');
  }

  const lightGateBlockers = validateLightEntryGate(dir, change);
  if (lightGateBlockers.length) {
    lib.event(root, 'hook.deny', { reason: lightGateBlockers[0], blockers: lightGateBlockers, paths: productionPaths });
    deny(lightGateBlockers[0], `light lane production edits require a valid light-gate.json (${lightGateBlockers.join(', ')}). Fix: use the specnav-light-change skill to create the compact entry gate before implementation.`);
  }

  const scope = lib.readFileScope(dir);
  if (!scope.ok) {
    lib.event(root, 'hook.deny', {
      reason: 'invalid-scope',
      blockers: scope.blockers || [],
      paths: productionPaths,
      scope_source: scope.source
    });
    deny('invalid-scope', `production edits require a valid scope.json (${(scope.blockers || []).join(', ') || 'invalid-scope'}). Fix: repair ${scope.source} for the active change.`);
  }

  const frozenTestPaths = collectFrozenTestPaths(dir);
  const promotedCheckRules = collectPromotedCheckRules(root);
  const reviewHits = [];
  for (const rel of productionPaths) {
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
    const scopeResult = pathAllowedByScope(scope, rel);
    if (!scopeResult.ok) {
      if (pathOverrideAllows(root, 'scope', rel, change)) continue;
      lib.event(root, 'hook.deny', {
        reason: 'scope',
        scope_reason: scopeResult.reason,
        path: rel,
        paths: productionPaths,
        include: scope.include,
        exclude: scope.exclude,
        scope_source: scope.source
      });
      deny('scope', `${rel} is outside declared SpecNav file scope from ${scope.source} (allowed: ${scope.include.join(', ') || 'none'}). Fix: extend scope.json allowed_roots or create a scope override.`);
    }
    if (scope.operations) {
      const operation = fs.existsSync(path.resolve(root, rel)) ? 'modify' : 'create';
      if (scope.operations[operation] === false && !pathOverrideAllows(root, 'operation', rel, change)) {
        lib.event(root, 'hook.deny', { reason: 'operation', operation, path: rel });
        deny('operation', `${operation} of ${rel} is blocked by scope.json allowed_operations. Fix: enable the operation in scope.json or create an operation override.`);
      }
    }
    for (const rule of promotedCheckRules) {
      if (rule.deny_globs.some((pattern) => lib.globLikeMatch(pattern, rel))) {
        if (pathOverrideAllows(root, 'promoted-check', rel, change)) continue;
        lib.event(root, 'hook.deny', { reason: `promoted-check:${rule.id}`, path: rel, rule: rule.id });
        deny(`promoted-check:${rule.id}`, `${rel} matches admitted promoted check ${rule.id}${rule.reason ? ` (${rule.reason})` : ''}. Fix: address the checked risk, or create a promoted-check override with a reason.`);
      }
    }
    if (Array.isArray(scope.reviewRequired) && scope.reviewRequired.some((pattern) => lib.globLikeMatch(pattern, rel))) {
      reviewHits.push(rel);
    }
  }

  if (reviewHits.length && !reviewHits.every((rel) => pathOverrideAllows(root, 'review', rel, change))) {
    lib.event(root, 'hook.warn', { reason: 'requires-review', paths: reviewHits });
    warn(root, `${reviewHits.join(', ')} match requires_review_on; escalate review (shared/dependency/migration) then add a review override.`);
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
