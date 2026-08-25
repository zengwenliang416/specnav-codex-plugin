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
const {
  COLLECTIONS,
  collectGenerationState,
  collectionInventory,
  createBaseline,
  createVerificationGenerationAuthority,
  verifyBaseline
} = require('./verification-generation-authority');

module.exports = {
  COLLECTIONS,
  collectGenerationState,
  collectionInventory,
  createBaseline,
  createCompatibilitySnapshot,
  compareCompatibilitySnapshots,
  createHostCompatibilityAuthority,
  createVerificationGenerationAuthority,
  verifyBaseline
};
