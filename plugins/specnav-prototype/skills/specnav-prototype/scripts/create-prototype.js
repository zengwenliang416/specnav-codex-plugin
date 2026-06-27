#!/usr/bin/env node
'use strict';

const path = require('path');
const runtime = require('../../../scripts/plugin-runtime');
const scaffold = runtime.requirePluginScript('specnav-core', 'scripts/scaffold-lib');

const skillRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(skillRoot, 'assets');

const branchAssets = {
  'ui-html': [
    { source: path.join(assetsRoot, 'ui-html'), target: 'artifact' },
    { source: path.join(assetsRoot, 'screen-map.json'), target: 'screen-map.json', file: true }
  ],
  'logic-state': [
    { source: path.join(assetsRoot, 'logic-state'), target: 'logic' }
  ],
  'api-contract': [
    { source: path.join(assetsRoot, 'api-contract'), target: 'api' }
  ],
  'data-flow': [
    { source: path.join(assetsRoot, 'data-flow'), target: '.' }
  ],
  'component-seam': [
    { source: path.join(assetsRoot, 'component-seam'), target: '.' }
  ]
};

function copyFileItem(sourceFile, targetFile) {
  return {
    source: path.dirname(sourceFile),
    target: path.dirname(targetFile),
    filter: path.basename(sourceFile)
  };
}

process.exit(scaffold.runScaffold({
  requiresChange: true,
  extraHelp: 'Use --branch=<ui-html|logic-state|api-contract|data-flow|component-seam> to choose a prototype branch.',
  items(options, context) {
    const branch = options.values.branch || 'ui-html';
    if (!branchAssets[branch]) {
      const error = new Error(`Unsupported prototype branch: ${branch}`);
      error.blocker = 'invalid-prototype-branch';
      throw error;
    }
    const prototypeDir = path.join(context.changeDir, 'prototype');
    const items = [
      copyFileItem(path.join(assetsRoot, 'question.md'), path.join(prototypeDir, 'question.md')),
      copyFileItem(path.join(assetsRoot, 'prototype-manifest.json'), path.join(prototypeDir, 'prototype-manifest.json'))
    ];

    for (const item of branchAssets[branch]) {
      if (item.file) {
        items.push(copyFileItem(item.source, path.join(prototypeDir, item.target)));
      } else {
        items.push({ source: item.source, target: path.join(prototypeDir, item.target) });
      }
    }
    return items;
  }
}));
