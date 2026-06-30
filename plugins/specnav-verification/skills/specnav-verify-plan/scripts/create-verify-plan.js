#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');
const codegraphPlan = runtime.requirePluginScript('specnav-codegraph', 'scripts/codegraph-plan');

const skillRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(skillRoot, 'assets');

process.exit(scaffold.runScaffold({
  requiresChange: true,
  extraHelp: 'Creates shared six-domain verification plan artifacts under openspec/changes/<active-change>/verify/.',
  items(_options, context) {
    return [
      {
        source: assetsRoot,
        target: path.join(context.changeDir, 'verify')
      }
    ];
  },
  afterCopy(options, context) {
    const result = codegraphPlan.plan({
      projectRoot: context.root,
      change: context.change,
      stage: 'verification',
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
}));
