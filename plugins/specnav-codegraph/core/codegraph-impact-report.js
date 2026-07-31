'use strict';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentity(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim();
}

function sorted(values) {
  return Array.from(new Set(values)).sort();
}

function createImpactReport(options = {}) {
  const evidence = options.evidence;
  const generatedAt = options.generatedAt;
  if (
    !isRecord(evidence)
    || !isIdentity(evidence.id)
    || !Array.isArray(evidence.files)
    || !Array.isArray(evidence.blockers)
    || evidence.blockers.some((entry) => !isIdentity(entry))
    || !isIdentity(generatedAt)
  ) {
    return {
      ok: false,
      report: null,
      blockers: ['codegraph:impact-report-invalid-input']
    };
  }

  const files = [];
  for (const entry of evidence.files) {
    if (!isRecord(entry) || !isIdentity(entry.path)) {
      return {
        ok: false,
        report: null,
        blockers: ['codegraph:impact-report-invalid-file']
      };
    }
    files.push({
      path: entry.path,
      evidence_refs: [evidence.id]
    });
  }

  const report = {
    schema: 'specnav.codegraph.impact.v1',
    generated_at: generatedAt,
    change_id: isIdentity(options.changeId) ? options.changeId : null,
    source_evidence_ids: [evidence.id],
    affected_files: files.sort((left, right) => (
      left.path.localeCompare(right.path)
    )),
    affected_case_ids: [],
    evidence_refs: sorted([
      `codegraph/evidence.jsonl#${evidence.id}`
    ]),
    blockers: sorted(evidence.blockers)
  };

  return {
    ok: report.blockers.length === 0,
    report,
    blockers: report.blockers
  };
}

module.exports = {
  createImpactReport
};
