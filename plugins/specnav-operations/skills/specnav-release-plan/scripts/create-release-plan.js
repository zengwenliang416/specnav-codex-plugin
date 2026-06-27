#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');

const skillRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(skillRoot, 'assets');
const targets = new Set(['local-only', 'plugin-marketplace', 'package', 'host-compatibility', 'project-deploy']);

process.exit(scaffold.runScaffold({
  requiresChange: true,
  extraHelp: 'Creates release-plan.md, release-checklist.json, changelog.md, and release-notes.md. Use --release-target=<target>.',
  items(options, context) {
    const target = options.values['release-target'] || options.values.releaseTarget;
    if (!targets.has(target)) {
      const error = new Error('A valid release target is required. Pass --release-target=<local-only|plugin-marketplace|package|host-compatibility|project-deploy>.');
      error.blocker = 'invalid-release-target';
      throw error;
    }
    return [
      {
        source: assetsRoot,
        target: path.join(context.changeDir, 'operations')
      }
    ];
  }
}));
