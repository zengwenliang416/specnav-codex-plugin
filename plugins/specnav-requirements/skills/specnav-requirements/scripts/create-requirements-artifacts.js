#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');

const skillRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(skillRoot, 'assets', 'change');

process.exit(scaffold.runScaffold({
  requiresChange: true,
  extraHelp: 'Creates missing change-level requirements artifacts under openspec/changes/<active-change>/.',
  items(_options, context) {
    return [
      {
        source: assetsRoot,
        target: context.changeDir
      }
    ];
  }
}));
