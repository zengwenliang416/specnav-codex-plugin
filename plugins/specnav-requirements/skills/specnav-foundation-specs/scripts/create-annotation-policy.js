#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');

const skillRoot = path.resolve(__dirname, '..');
// Deliberately sourced from assets-optional/, NOT assets/, so the required
// foundation-spec scaffold never bundles this opt-in L3 policy.
const assetsRoot = path.join(skillRoot, 'assets-optional');

process.exit(scaffold.runScaffold({
  requiresChange: false,
  extraHelp: 'Creates the OPTIONAL L3 ai-annotation-policy spec under openspec/specs/. Ships advisory; flip enforcement to gate to opt into anchor gating.',
  items(_options, context) {
    return [
      {
        source: assetsRoot,
        target: path.join(context.root, 'openspec', 'specs')
      }
    ];
  }
}));
