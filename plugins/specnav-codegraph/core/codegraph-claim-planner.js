#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./codegraph-evidence-store');

const VALID_STAGES = new Set(['development', 'verification', 'operations', 'all']);

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function dirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function slug(value, fallback = 'claim') {
  const text = String(value || '')
    .toLowerCase()
    .replace(/`[^`]+`/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return text || fallback;
}

function relChange(change, ...segments) {
  return path.join('openspec', 'changes', change, ...segments).replace(/\\/g, '/');
}

function cleanList(values) {
  return unique((Array.isArray(values) ? values : []).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()));
}

function section(text, heading) {
  const lines = String(text || '').split(/\r?\n/);
  const wanted = heading.toLowerCase();
  let collecting = false;
  const out = [];
  for (const line of lines) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) {
      if (collecting) break;
      collecting = match[1].trim().toLowerCase() === wanted;
      continue;
    }
    if (collecting) out.push(line);
  }
  return out.join('\n').trim();
}

function parseTasksMarkdown(file) {
  return readText(file)
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function taskDirs(changeDir) {
  const tasksDir = path.join(changeDir, 'development', 'tasks');
  try {
    return fs.readdirSync(tasksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function readTask(changeDir, change, taskId) {
  const taskDir = path.join(changeDir, 'development', 'tasks', taskId);
  const context = readJson(path.join(taskDir, 'context.json'), {});
  const brief = readText(path.join(taskDir, 'brief.md'));
  const goal = typeof context.goal === 'string' && context.goal.trim()
    ? context.goal.trim()
    : (section(brief, 'Goal').split(/\r?\n/).find((line) => line.trim()) || `Task ${taskId} is implemented`).trim();
  const verticalSlice = section(brief, 'Vertical Slice').split(/\r?\n/).find((line) => line.trim());
  return {
    taskId,
    goal,
    text: verticalSlice ? verticalSlice.trim() : goal,
    source_paths: [
      relChange(change, 'development', 'tasks', taskId, 'brief.md'),
      relChange(change, 'development', 'tasks', taskId, 'context.json')
    ],
    expected_evidence: cleanList(context.expected_evidence),
    allowed_files: cleanList(context.allowed_files)
  };
}

function fallbackClaim(change, stage) {
  const id = `${stage}:change-${slug(change, 'active-change')}`;
  const text = stage === 'verification'
    ? `Verification can map implemented code for ${change} back to requirements, prototype decisions, tasks, and changed files.`
    : `Implementation for ${change} matches requirements, acceptance, prototype handoff, data flow, and component architecture constraints.`;
  return {
    id,
    kind: stage === 'verification' ? 'verification-traceability' : 'change-implementation',
    stage,
    text,
    required: true,
    source: 'specnav-codegraph-plan',
    source_paths: [
      relChange(change, 'requirements.md'),
      relChange(change, 'acceptance.md')
    ],
    query_ids: [`${id}:evidence`]
  };
}

function claimForTask(change, stage, task) {
  const id = `${stage}:task-${task.taskId}`;
  return {
    id,
    kind: stage === 'verification' ? 'verification-task-traceability' : 'development-task',
    stage,
    task_id: task.taskId,
    text: task.text,
    required: true,
    source: 'specnav-codegraph-plan',
    source_paths: task.source_paths,
    expected_evidence: task.expected_evidence,
    allowed_files: task.allowed_files,
    query_ids: [`${id}:evidence`]
  };
}

function queryForClaim(change, claim) {
  const stageText = claim.stage === 'verification'
    ? 'Verify the implemented files, symbols, callers, tests, and requirement/prototype traceability for'
    : 'Find the files, symbols, components, routes, services, data flow, and tests that implement';
  return {
    id: claim.query_ids[0],
    claim_id: claim.id,
    stage: claim.stage,
    task_id: claim.task_id || null,
    status: 'planned',
    query: `${stageText} "${claim.text}" in change "${change}". Return concrete file paths, symbols, relationships, and any missing implementation evidence.`,
    expected_evidence: [
      'file paths',
      'symbols',
      'call relationships',
      'tests or verification commands'
    ],
    command: `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-context.js" --stage ${claim.stage} --claim ${claim.id} --query "<query>" --write --json`
  };
}

function generatedClaims(projectRoot, change, stage) {
  const changeDir = path.join(projectRoot, 'openspec', 'changes', change);
  const claims = [];
  const stages = stage === 'all' ? ['development', 'verification'] : [stage];
  const tasks = taskDirs(changeDir).map((taskId) => readTask(changeDir, change, taskId));
  const taskBullets = parseTasksMarkdown(path.join(changeDir, 'tasks.md'));

  for (const selectedStage of stages) {
    if (selectedStage !== 'development' && selectedStage !== 'verification') continue;
    if (tasks.length) {
      claims.push(...tasks.map((task) => claimForTask(change, selectedStage, task)));
    } else if (taskBullets.length) {
      claims.push(...taskBullets.map((text) => claimForTask(change, selectedStage, {
        taskId: slug(text, 'task'),
        text,
        goal: text,
        source_paths: [relChange(change, 'tasks.md')],
        expected_evidence: [],
        allowed_files: []
      })));
    } else {
      claims.push(fallbackClaim(change, selectedStage));
    }
  }

  return claims;
}

function mergeById(existing, generated) {
  const result = [];
  const byId = new Map();
  for (const item of Array.isArray(existing) ? existing : []) {
    if (!item || typeof item.id !== 'string') continue;
    byId.set(item.id, item);
    result.push(item);
  }
  for (const item of generated) {
    const previous = byId.get(item.id);
    if (previous) {
      Object.assign(previous, item, {
        manual_notes: previous.manual_notes,
        evidence_override: previous.evidence_override
      });
    } else {
      byId.set(item.id, item);
      result.push(item);
    }
  }
  return result;
}

function plan(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_DIR || process.cwd());
  const change = options.change || process.env.SPECNAV_CHANGE || store.activeChange(projectRoot);
  const stage = options.stage || 'development';
  const blockers = [];

  if (!VALID_STAGES.has(stage)) blockers.push('invalid-stage');
  if (!change) blockers.push('active-change');
  if (!dirExists(path.join(projectRoot, 'openspec'))) blockers.push('missing-openspec');
  if (blockers.length) return { ok: false, project_root: projectRoot, active_change: change || null, stage, blockers };

  const paths = store.artifactPaths(projectRoot, change);
  const existingClaims = store.readJson(paths.claimsMap, { claims: [] });
  const existingPlan = store.readJson(path.join(paths.dir, 'evidence-query-plan.json'), { queries: [] });
  const newClaims = generatedClaims(projectRoot, change, stage);
  const claims = mergeById(existingClaims.claims, newClaims);
  const generatedQueries = newClaims.map((claim) => queryForClaim(change, claim));
  const queries = mergeById(existingPlan.queries, generatedQueries);
  const claimsMap = {
    schema: 'specnav.codegraph.claims.v1',
    generated_at: new Date().toISOString(),
    active_change: change,
    claims
  };
  const queryPlan = {
    schema: 'specnav.codegraph.evidence_query_plan.v1',
    generated_at: new Date().toISOString(),
    active_change: change,
    queries
  };
  const written = [];

  if (options.write === true) {
    store.writeJson(paths.claimsMap, claimsMap);
    store.writeJson(path.join(paths.dir, 'evidence-query-plan.json'), queryPlan);
    written.push(paths.claimsMap, path.join(paths.dir, 'evidence-query-plan.json'));
  }

  return {
    ok: true,
    project_root: projectRoot,
    active_change: change,
    stage,
    claims_map: claimsMap,
    evidence_query_plan: queryPlan,
    written,
    blockers: []
  };
}

module.exports = {
  plan
};
