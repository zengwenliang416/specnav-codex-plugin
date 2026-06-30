#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');
const codegraphPlan = runtime.requirePluginScript('specnav-codegraph', 'scripts/codegraph-plan');

const skillRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(skillRoot, 'assets');

function invalidTaskId(value) {
  return !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '');
}

function fileItem(sourceFile, targetFile) {
  return {
    source: path.dirname(sourceFile),
    target: path.dirname(targetFile),
    filter: path.basename(sourceFile)
  };
}

function renderTemplate(text, values) {
  return Object.entries(values).reduce((output, [key, value]) => {
    return output.split(`{{${key}}}`).join(String(value));
  }, text);
}

function shouldDropTaskContextLine(line, taskId) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  try {
    const entry = JSON.parse(trimmed);
    return entry.source === 'development-entry-scaffold'
      || entry.status === 'pending-vertical-slices'
      || (
        entry.task_id === taskId
        && entry.source === 'specnav-vertical-slices'
        && entry.status === 'task-ready'
      );
  } catch {
    return false;
  }
}

function writeTaskContext(options, context) {
  const taskId = context.values.SPECNAV_TASK_ID;
  const target = path.join(context.changeDir, 'development', 'task-context.jsonl');
  const template = '{"task_id":"{{SPECNAV_TASK_ID}}","status":"task-ready","source":"specnav-vertical-slices","note":"Task packet created; fill brief.md and context.json before development entry can pass."}';
  const line = renderTemplate(template, context.values);
  const exists = fs.existsSync(target);

  if (options.dryRun) {
    return [{ status: exists ? 'would-update' : 'would-create', source: 'generated:task-context', target }];
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existingLines = exists ? fs.readFileSync(target, 'utf8').split(/\r?\n/) : [];
  const keptLines = existingLines.filter((existingLine) => !shouldDropTaskContextLine(existingLine, taskId));
  keptLines.push(line);
  fs.writeFileSync(target, `${keptLines.join('\n')}\n`);
  return [{ status: exists ? 'updated' : 'created', source: 'generated:task-context', target }];
}

function writeCodeGraphPlan(options, context) {
  const result = codegraphPlan.plan({
    projectRoot: context.root,
    change: context.change,
    stage: 'development',
    write: !options.dryRun
  });
  if (!result.ok) {
    const error = new Error(`CodeGraph plan generation failed: ${(result.blockers || []).join(', ')}`);
    error.blocker = (result.blockers || [])[0] || 'codegraph-plan-failed';
    throw error;
  }
  return (result.written || []).map((target) => ({
    status: 'updated',
    source: 'generated:codegraph-plan',
    target
  }));
}

process.exit(scaffold.runScaffold({
  requiresChange: true,
  extraHelp: 'Creates tasks.md, development task packet shells, ledger shells, and handoff shell. Use --task-id=<id>.',
  items(options, context) {
    const taskId = options.values['task-id'] || options.values.taskId;
    if (!taskId) {
      const error = new Error('A task id is required. Pass --task-id=<id>.');
      error.blocker = 'missing-task-id';
      throw error;
    }
    if (invalidTaskId(taskId)) {
      const error = new Error('Task id must be lowercase kebab-case with letters, digits, and hyphens only.');
      error.blocker = 'invalid-task-id';
      throw error;
    }
    context.values.SPECNAV_TASK_ID = taskId;
    return [
      fileItem(path.join(assetsRoot, 'tasks.md'), path.join(context.changeDir, 'tasks.md')),
      {
        source: path.join(assetsRoot, 'task'),
        target: path.join(context.changeDir, 'development', 'tasks', taskId)
      },
      {
        source: path.join(assetsRoot, 'development'),
        target: path.join(context.changeDir, 'development')
      }
    ];
  },
  afterCopy(options, context) {
    return [
      ...writeTaskContext(options, context),
      ...writeCodeGraphPlan(options, context)
    ];
  }
}));
