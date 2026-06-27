#!/usr/bin/env node
'use strict';

const fs = require('fs');
const lib = require('./specnav-lib');
const workflow = require('./workflow-state');
const affordances = require('./affordances');

function output(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  }));
}

function main() {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const root = lib.projectRoot(['node', 'specnav-user-prompt-submit', payload.cwd || process.cwd()]);

  if (!fs.existsSync(lib.openspecDir(root))) {
    output([
      '<specnav-state>',
      'OpenSpec is missing for this project. Only SpecNav bootstrap, doctor, status, and read-only discovery actions are legal.',
      'Use $specnav-bootstrap to initialize OpenSpec before requirements, prototype, development, verification, or operations work.',
      '</specnav-state>'
    ].join('\n'));
    return;
  }

  const state = workflow.workflowState(root);
  const ready = affordances.buildAffordances(root);
  const readyActions = (ready.actions || [])
    .filter((action) => action.state === 'ready')
    .map((action) => action.id);
  output([
    '<specnav-state>',
    `stage: ${state.status}`,
    `active_change: ${state.active_change || 'none'}`,
    `ready_actions: ${readyActions.join(', ') || 'none'}`,
    `blockers: ${(ready.blockers || []).join(', ') || 'none'}`,
    '</specnav-state>'
  ].join('\n'));
}

try {
  main();
} catch (error) {
  output(`<specnav-state>SpecNav prompt hook failed: ${error.message}</specnav-state>`);
}
