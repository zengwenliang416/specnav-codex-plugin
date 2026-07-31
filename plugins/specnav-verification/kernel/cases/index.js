'use strict';

const {
  canonicalStringify,
  canonicalValue,
  hashCanonical
} = require('./canonical');
const { normalizeCase, normalizeSourceList } = require('./normalize');
const { createCasePlanner } = require('./planner');
const {
  computeSnapshotHash,
  createCaseSnapshotWriter,
  snapshotContent
} = require('./snapshot-writer');
const {
  createCaseApprovalValidator
} = require('./approval-validator');

module.exports = Object.freeze({
  canonicalStringify,
  canonicalValue,
  computeSnapshotHash,
  createCaseApprovalValidator,
  createCasePlanner,
  createCaseSnapshotWriter,
  hashCanonical,
  normalizeCase,
  normalizeSourceList,
  snapshotContent
});
