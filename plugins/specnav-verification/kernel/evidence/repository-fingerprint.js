'use strict';

const crypto = require('node:crypto');

const GOVERNANCE_ROOTS = Object.freeze([
  '.codegraph/',
  '.specnav/',
  'openspec/'
]);

function trackedPath(line) {
  if (typeof line !== 'string') return null;
  const separator = line.indexOf('\t');
  if (separator < 0) return null;
  const value = line.slice(separator + 1);
  return value || null;
}

function isGovernancePath(file) {
  return GOVERNANCE_ROOTS.some((root) => file.startsWith(root));
}

function codeInventory(treeInventory) {
  if (typeof treeInventory !== 'string') {
    throw new TypeError('verification-fingerprint:tree-inventory-required');
  }
  return treeInventory
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const file = trackedPath(line);
      return file !== null && !isGovernancePath(file);
    })
    .sort()
    .join('\n');
}

function codeInventorySha(treeInventory) {
  return crypto.createHash('sha1')
    .update('specnav-code-inventory-v1\n')
    .update(codeInventory(treeInventory))
    .digest('hex');
}

module.exports = {
  GOVERNANCE_ROOTS,
  codeInventory,
  codeInventorySha,
  isGovernancePath,
  trackedPath
};
