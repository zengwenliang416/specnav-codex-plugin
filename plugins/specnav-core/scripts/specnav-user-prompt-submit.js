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

  if (lib.isSpecNavDisabled(root)) {
    return;
  }

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
  const legacyEntrypoints = ready.legacy_openspec_entrypoints || [];
  const legacyLines = legacyEntrypoints.length
    ? [
        `legacy_openspec_entrypoints: ${legacyEntrypoints.map((entry) => `${entry.name} (${entry.path})`).join(', ')}`,
        'native_openspec_skills: disabled; route through SpecNav requirements/prototype/development/verification/operations instead'
      ]
    : [
        'native_openspec_skills: disabled when SpecNav is active; use OpenSpec CLI only as commanded by SpecNav contracts'
      ];
  output([
    '<specnav-state>',
    `stage: ${state.status}`,
    `active_change: ${state.active_change || 'none'}`,
    `ready_actions: ${readyActions.join(', ') || 'none'}`,
    `blockers: ${(ready.blockers || []).join(', ') || 'none'}`,
    ...legacyLines,
    'completion_rule: do not claim a stage complete or hand off until the owning SpecNav contract returns ok:true',
    '</specnav-state>'
  ].join('\n'));
}

try {
  main();
} catch (error) {
  output(`<specnav-state>SpecNav prompt hook failed: ${error.message}</specnav-state>`);
}
