#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');

const skillRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(skillRoot, 'assets');

process.exit(scaffold.runScaffold({
  requiresChange: true,
  extraHelp: 'Creates or refreshes openspec/changes/<active-change>/scope.json from the scope template.',
  items(_options, context) {
    return [
      {
        source: assetsRoot,
        target: context.changeDir
      }
    ];
  }
}));
