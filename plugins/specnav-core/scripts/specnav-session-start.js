#!/usr/bin/env node
'use strict';

const fs = require('fs');
const lib = require('./specnav-lib');
const workflow = require('./workflow-state');

function output(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext
    }
  }));
}

function main() {
  const root = lib.projectRoot();
  if (!fs.existsSync(lib.openspecDir(root))) {
    if (lib.isSpecNavProject(root)) {
      output([
        '<specnav-session>',
        'SpecNav is active for this project, but openspec/ is missing.',
        'Only $specnav-bootstrap, $specnav-status, and $specnav-doctor are legal before production work.',
        `project_root: ${root}`,
        '</specnav-session>'
      ].join('\n'));
      return;
    }
    output([
      '<specnav-session>',
      'SpecNav is installed but inactive for this project because openspec/ and .specnav.json are both absent.',
      'Use $specnav-bootstrap if this project should enter the SpecNav OpenSpec lifecycle.',
      `project_root: ${root}`,
      '</specnav-session>'
    ].join('\n'));
    return;
  }

  const state = workflow.writeRuntimeArtifacts(root);
  lib.event(root, 'session.start', { cwd: root, status: state.status });
  output([
    '<specnav-session>',
    'SpecNav OpenSpec lifecycle is active.',
    `project_root: ${root}`,
    `status: ${state.status}`,
    `blockers: ${state.blockers.join(', ') || 'none'}`,
    'workflow_state: openspec/.specnav/workflow-state.json',
    '</specnav-session>'
  ].join('\n'));
}

try {
  main();
} catch (error) {
  output(`<specnav-session>SpecNav session hook failed: ${error.message}</specnav-session>`);
}
