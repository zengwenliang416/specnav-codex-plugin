'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const {
  createImpactReport
} = require(path.join(
  ROOT,
  'plugins/specnav-codegraph/core/codegraph-impact-report'
));

test('CodeGraph evidence projects to a deterministic versioned impact report', () => {
  const result = createImpactReport({
    changeId: 'change-v2',
    generatedAt: '2026-07-31T21:30:00Z',
    evidence: {
      id: 'ev-impact',
      files: [
        { path: 'src/ui.js' },
        { path: 'src/api.js' }
      ],
      blockers: []
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.report, {
    schema: 'specnav.codegraph.impact.v1',
    generated_at: '2026-07-31T21:30:00Z',
    change_id: 'change-v2',
    source_evidence_ids: ['ev-impact'],
    affected_files: [
      {
        path: 'src/api.js',
        evidence_refs: ['ev-impact']
      },
      {
        path: 'src/ui.js',
        evidence_refs: ['ev-impact']
      }
    ],
    affected_case_ids: [],
    evidence_refs: ['codegraph/evidence.jsonl#ev-impact'],
    blockers: []
  });
});

test('blocked or malformed CodeGraph evidence cannot manufacture usable impact', () => {
  const blocked = createImpactReport({
    changeId: 'change-v2',
    generatedAt: '2026-07-31T21:30:00Z',
    evidence: {
      id: 'ev-impact',
      files: [],
      blockers: ['codegraph:index-stale']
    }
  });
  const malformed = createImpactReport({
    changeId: 'change-v2',
    generatedAt: '2026-07-31T21:30:00Z',
    evidence: {
      id: 'ev-impact',
      files: [{ path: '' }],
      blockers: []
    }
  });

  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.report.blockers, ['codegraph:index-stale']);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.report, null);
  assert.deepEqual(malformed.blockers, [
    'codegraph:impact-report-invalid-file'
  ]);
});
