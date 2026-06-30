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

function addPath(paths, value) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) paths.add(trimmed);
}

function collectPaths(value, paths) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, paths);
    return;
  }
  addPath(paths, value.file_path);
  addPath(paths, value.path);
  addPath(paths, value.notebook_path);
  addPath(paths, value.destination_path);
  addPath(paths, value.target_path);
  for (const key of ['edits', 'files', 'paths', 'targets']) {
    collectPaths(value[key], paths);
  }
}

function normalizePayload(payload) {
  const input = payload.tool_input || payload.input || {};
  const paths = new Set();
  collectPaths(input, paths);
  return {
    tool: toolName(payload),
    command: typeof input.command === 'string' ? input.command : '',
    paths: Array.from(paths)
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

function deny(message) {
  console.error(`SpecNav gate denied: ${message}`);
  process.exit(2);
}

function warn(root, message) {
  console.error(`SpecNav gate warning: ${message}`);
  lib.event(root, 'hook.warn', { message });
  process.exit(1);
}

function allow(root, reason = 'allow') {
  lib.event(root, 'hook.allow', { reason });
  process.exit(0);
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
  if (normalized.command && /\brm\s+-rf\s+\/|\bsudo\b|curl\b.+\|\s*(sh|bash)|wget\b.+\|\s*(sh|bash)/.test(normalized.command)) {
    if (overrideAllows(root, 'dangerous-command', { command: normalized.command })) {
      allow(root, 'override-dangerous-command');
    }
    lib.event(root, 'hook.deny', { reason: 'dangerous-command' });
    deny('dangerous shell command requires explicit manual review.');
  }
  if (lib.isSpecNavProject(root) && isBashTool(normalized.tool) && isLegacyOpenSpecWorkflowCommand(normalized.command)) {
    lib.event(root, 'hook.deny', { reason: 'legacy-openspec-workflow-command', command: normalized.command });
    deny('native OpenSpec workflow entrypoints are disabled inside SpecNav projects; use SpecNav requirements/prototype/development/verification/operations commands instead.');
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
    deny('missing openspec/ blocks production work; initialize or repair OpenSpec first.');
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
    deny(`legacy OpenSpec workflow entrypoints are present: ${legacyEntrypoints.map((entry) => entry.name).join(', ')}. Disable them or replace them with SpecNav disabled stubs before production edits.`);
  }
  if (!change || !dir) {
    const blockers = changeState.blockers && changeState.blockers.length ? changeState.blockers : ['active-change'];
    lib.event(root, 'hook.deny', { reason: blockers[0], paths: productionPaths, candidates: changeState.candidates || [] });
    deny(`production edits require an explicit SpecNav change: ${blockers.join(', ')}. Set SPECNAV_CHANGE or repair openspec/.specnav/change-registry.json.`);
  }

  if (!lib.fileExists(path.join(dir, 'tasks.md'))) {
    const overridden = productionPaths.every((rel) => pathOverrideAllows(root, 'missing-tasks', rel, change));
    if (overridden) {
      allow(root, 'override-missing-tasks');
    }
    lib.event(root, 'hook.deny', { reason: 'missing-tasks', paths: productionPaths });
    deny('production edits require an active OpenSpec change with tasks.md.');
  }

  const scope = lib.readFileScope(dir);
  if (!scope.ok) {
    lib.event(root, 'hook.deny', {
      reason: 'invalid-scope',
      blockers: scope.blockers || [],
      paths: productionPaths,
      scope_source: scope.source
    });
    deny(`production edits require a valid scope.json: ${(scope.blockers || []).join(', ') || 'invalid-scope'}.`);
  }

  const reviewHits = [];
  for (const rel of productionPaths) {
    if (/^tests\/acceptance\//.test(rel)) {
      if (pathOverrideAllows(root, 'frozen-acceptance', rel, change)) continue;
      lib.event(root, 'hook.deny', { reason: 'frozen-acceptance', path: rel });
      deny(`acceptance contract is frozen during implementation: ${rel}`);
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
      deny(`${rel} is outside declared SpecNav file scope from ${scope.source}: ${scope.include.join(', ') || '(no include scope)'}`);
    }
    if (scope.operations) {
      const operation = fs.existsSync(path.resolve(root, rel)) ? 'modify' : 'create';
      if (scope.operations[operation] === false && !pathOverrideAllows(root, 'operation', rel, change)) {
        lib.event(root, 'hook.deny', { reason: 'operation', operation, path: rel });
        deny(`${operation} of ${rel} is blocked by scope.json allowed_operations.`);
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
  collectPaths,
  normalizePayload,
  pathAllowedByScope,
  toRelativeProjectPath
};
