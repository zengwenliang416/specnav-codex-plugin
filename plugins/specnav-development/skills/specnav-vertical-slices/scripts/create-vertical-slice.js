#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');

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
  }
}));
