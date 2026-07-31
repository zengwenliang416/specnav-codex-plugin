'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const CASES_MODULE = path.join(
  ROOT,
  'plugins/specnav-verification/kernel/cases'
);
const FIXTURE_ROOT = path.join(
  ROOT,
  'tests/verification-v2/contracts/fixtures/positive'
);

const { readySchemaRegistry } = require(
  '../contracts/cross-reference/test-helpers'
);

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));
}

function sampleCase(overrides = {}) {
  const value = readFixture('test-case.json');
  value.change_id = 'verification-2-0';
  value.requirement_ids = ['REQ-01'];
  value.acceptance_ids = ['AC-01', 'AC-02'];
  value.id = overrides.id || 'case-primary';
  return Object.assign(value, overrides);
}

function sources() {
  return {
    requirements: [{
      id: 'REQ-01',
      statement: 'Reviewer can approve the test contract.'
    }],
    acceptance: [
      {
        id: 'AC-01',
        statement: 'Reviewer can inspect every proposed case.'
      },
      {
        id: 'AC-02',
        statement: 'Execution requires current explicit approval.'
      }
    ]
  };
}

function reviewer(id = 'reviewer-1') {
  return {
    id,
    kind: 'human',
    display_name: 'Verification reviewer'
  };
}

function requireCasesModule() {
  return require(CASES_MODULE);
}

module.exports = {
  CASES_MODULE,
  ROOT,
  readFixture,
  readySchemaRegistry,
  requireCasesModule,
  reviewer,
  sampleCase,
  sources
};
