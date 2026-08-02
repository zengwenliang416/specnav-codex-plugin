'use strict';

const {
  createCompatibilitySnapshot
} = require('./compatibility-snapshot');
const {
  compareCompatibilitySnapshots
} = require('./cross-host-drift');

module.exports = {
  createCompatibilitySnapshot,
  compareCompatibilitySnapshots
};
