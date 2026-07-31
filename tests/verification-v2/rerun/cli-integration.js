'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(
  ROOT,
  'plugins/specnav-verification/scripts/rerun-scope.js'
);
const {
  readySchemaRegistry,
  requireCasesModule,
  reviewer,
  sampleCase
} = require('../cases/test-helpers');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-rerun-'));
const change = 'rerun-change';
const verifyDir = path.join(project, 'openspec/changes', change, 'verify');
const codegraphDir = path.join(
  project,
  'openspec/changes',
  change,
  'codegraph'
);

const currentRequirements = [
  {
    id: 'REQ-api',
    statement: 'The API repair remains covered.'
  },
  {
    id: 'REQ-baseline',
    statement: 'The mandatory baseline remains covered.'
  }
];
const currentAcceptance = [
  {
    id: 'AC-api',
    statement: 'The repaired API case reruns.'
  },
  {
    id: 'AC-baseline',
    statement: 'The mandatory baseline case reruns.'
  }
];
const {
  createCasePlanner,
  createCaseSnapshotWriter
} = requireCasesModule();
const schemaRegistry = readySchemaRegistry();
const plan = createCasePlanner({ schemaRegistry }).plan({
  changeId: change,
  requirements: currentRequirements,
  acceptance: currentAcceptance,
  cases: [
    sampleCase({
      id: 'case-api',
      change_id: change,
      requirement_ids: ['REQ-api'],
      acceptance_ids: ['AC-api']
    }),
    sampleCase({
      id: 'case-baseline',
      change_id: change,
      requirement_ids: ['REQ-baseline'],
      acceptance_ids: ['AC-baseline']
    })
  ]
});
assert.equal(plan.ok, true, JSON.stringify(plan.blockers));
const snapshotResult = createCaseSnapshotWriter({ schemaRegistry }).create({
  plan,
  createdAt: '2026-07-31T21:30:00Z',
  createdBy: reviewer()
});
assert.equal(
  snapshotResult.ok,
  true,
  JSON.stringify(snapshotResult.blockers)
);
const snapshot = snapshotResult.snapshot;
writeJson(path.join(verifyDir, 'case-snapshot.json'), snapshot);
writeJson(path.join(verifyDir, 'case-approval.json'), {
  schema: 'specnav.verification.case-approval.v1',
  id: 'approval-cli',
  change_id: change,
  snapshot_id: snapshot.id,
  snapshot_hash: snapshot.snapshot_hash,
  decision: 'approved',
  reviewer: reviewer(),
  decided_at: '2026-07-31T21:31:00Z'
});
writeJson(
  path.join(verifyDir, 'current-requirements.json'),
  currentRequirements
);
writeJson(
  path.join(verifyDir, 'current-acceptance.json'),
  currentAcceptance
);
writeJson(path.join(verifyDir, 'case-freshness.json'), {
  cases: [
    { case_id: 'case-api', status: 'fresh', reasons: [] },
    { case_id: 'case-baseline', status: 'fresh', reasons: [] }
  ]
});
writeJson(path.join(verifyDir, 'rerun-policy.json'), {
  mandatory_baseline_case_ids: ['case-baseline'],
  policy_refs: ['verify/rerun-policy.json#mandatory_baseline_case_ids']
});
writeJson(path.join(verifyDir, 'traceability-matrix.json'), {
  schema_version: 2,
  change_id: change,
  entries: [
    {
      changed_file: 'src/api.js',
      case_ids: ['case-api'],
      requirement_refs: ['REQ-api'],
      verification_domains: ['unit']
    }
  ],
  unmapped_changes: []
});
writeJson(path.join(codegraphDir, 'impact-report.json'), {
  schema: 'specnav.codegraph.impact.v1',
  generated_at: '2026-07-31T21:32:00Z',
  change_id: change,
  source_evidence_ids: ['ev-cli'],
  affected_files: [],
  affected_case_ids: [],
  evidence_refs: ['codegraph/impact-report.json'],
  blockers: []
});

const run = childProcess.spawnSync(process.execPath, [
  SCRIPT,
  '--change',
  change,
  '--files',
  'src/api.js',
  '--repaired',
  'case-api',
  '--reviewer-id',
  'reviewer-1',
  '--json'
], {
  cwd: ROOT,
  env: {
    ...process.env,
    PROJECT_DIR: project
  },
  encoding: 'utf8'
});

assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.ok, true);
assert.deepEqual(result.required_cases, ['case-api', 'case-baseline']);
assert.deepEqual(result.baseline_cases, ['case-baseline']);
assert.deepEqual(result.repaired_cases, ['case-api']);
assert.deepEqual(result.reasons_by_case['case-api'], [
  'repaired-case',
  'traceability:case:case-api',
  'traceability:changed-file:src/api.js',
  'traceability:requirement:REQ-api'
]);
assert.deepEqual(result.reasons_by_case['case-baseline'], [
  'policy-baseline'
]);
assert.deepEqual(result.blocker_ids, []);

writeJson(path.join(verifyDir, 'traceability-matrix.json'), {
  schema_version: 2,
  change_id: change,
  entries: 'invalid'
});
const malformed = childProcess.spawnSync(process.execPath, [
  SCRIPT,
  '--change',
  change,
  '--files',
  'src/api.js',
  '--reviewer-id',
  'reviewer-1',
  '--json'
], {
  cwd: ROOT,
  env: {
    ...process.env,
    PROJECT_DIR: project
  },
  encoding: 'utf8'
});
assert.equal(malformed.status, 2, malformed.stderr || malformed.stdout);
const malformedResult = JSON.parse(malformed.stdout);
assert.deepEqual(malformedResult.blocker_ids, [
  'invalid-verify-artifact:traceability-matrix.json'
]);
assert.deepEqual(malformedResult.blockers, [{
  id: 'invalid-verify-artifact:traceability-matrix.json',
  artifact: 'traceability-matrix.json',
  detail: 'entries'
}]);

process.stdout.write('verification v2 case-level rerun CLI fixture ok\n');
