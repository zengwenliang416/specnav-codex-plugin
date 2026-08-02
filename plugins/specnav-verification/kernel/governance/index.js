'use strict';

const {
  createCompatibilitySnapshot
} = require('./compatibility-snapshot');
const {
  compareCompatibilitySnapshots
} = require('./cross-host-drift');
const {
  createHostCompatibilityAuthority
} = require('./host-authority');

module.exports = {
  createCompatibilitySnapshot,
  compareCompatibilitySnapshots,
  createHostCompatibilityAuthority
};
