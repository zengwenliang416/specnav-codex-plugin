'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const REPORT_FILES = Object.freeze([
  'overview.html',
  'test-case-catalog.html',
  'test-case-results.html'
]);

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableIds(values) {
  return [...new Set(values)].sort();
}

function compareAttempts(left, right) {
  return left.sequence - right.sequence
    || String(left.completed_at || '').localeCompare(
      String(right.completed_at || '')
    )
    || String(left.started_at || '').localeCompare(
      String(right.started_at || '')
    )
    || left.id.localeCompare(right.id);
}

function currentReadings(snapshot, attempts, readings) {
  const latestAttemptIds = new Set();
  for (const testCase of snapshot.cases) {
    const latest = attempts
      .filter((entry) => entry.case_id === testCase.id)
      .sort(compareAttempts)
      .at(-1);
    if (latest) latestAttemptIds.add(latest.id);
  }
  return readings.filter((entry) => latestAttemptIds.has(entry.attempt_id));
}

function mergeIntegrity(verificationRoot, runs, attempts) {
  const facts = [];
  const blockers = [];
  for (const run of runs) {
    const runAttempts = attempts.filter((entry) => entry.run_id === run.id);
    if (runAttempts.length === 0) {
      blockers.push(blocker(
        'verification-production:attempt-history-missing',
        run.id
      ));
      continue;
    }
    const attemptValues = [];
    for (const attempt of runAttempts) {
      const file = path.join(
        verificationRoot,
        'runs',
        run.id,
        'attempts',
        attempt.id,
        'integrity.json'
      );
      const value = readJson(file);
      if (!value) {
        blockers.push(blocker(
          'verification-production:attempt-integrity-missing',
          attempt.id
        ));
        continue;
      }
      attemptValues.push(value);
      facts.push(...(value.facts?.evidence || []));
      blockers.push(...(value.blockers || []));
    }
    const runFile = path.join(
      verificationRoot,
      'runs',
      run.id,
      'integrity.json'
    );
    const runValue = readJson(runFile);
    if (!runValue) {
      blockers.push(blocker(
        'verification-production:integrity-missing',
        run.id
      ));
      continue;
    }
    const recomputed = require('./production-runner')
      .mergeIntegrityResults(attemptValues);
    if (canonicalJson(runValue) !== canonicalJson(recomputed)) {
      blockers.push(blocker(
        'verification-production:run-integrity-mismatch',
        run.id
      ));
    }
  }
  const byId = new Map();
  for (const fact of facts) {
    if (!fact || typeof fact.evidence_id !== 'string') continue;
    const prior = byId.get(fact.evidence_id);
    if (prior && canonicalJson(prior) !== canonicalJson(fact)) {
      blockers.push(blocker(
        'verification-production:integrity-fact-conflict',
        fact.evidence_id
      ));
      continue;
    }
    byId.set(fact.evidence_id, fact);
  }
  const evidence = [...byId.values()].sort((left, right) => (
    left.evidence_id.localeCompare(right.evidence_id)
  ));
  const intact = evidence.length > 0 && evidence.every((entry) => (
    entry.integrity === 'intact'
    && entry.freshness === 'fresh'
    && entry.exists === true
    && entry.hash_match === true
    && entry.size_match === true
    && entry.producer_recognized === true
    && entry.store_record_match === true
    && entry.binding_match === true
    && entry.path_safe === true
  ));
  return {
    ok: blockers.length === 0 && intact,
    facts: {
      summary: {
        evidence_count: evidence.length,
        integrity: intact ? 'intact' : 'broken',
        freshness: evidence.length > 0 && evidence.every(
          (entry) => entry.freshness === 'fresh'
        )
          ? 'fresh'
          : 'unknown'
      },
      evidence
    },
    blockers
  };
}

function freshnessProjection(snapshot, runs, attempts, checkedAt) {
  const cases = snapshot.cases.map((testCase) => {
    const candidates = attempts.filter((entry) => entry.case_id === testCase.id)
      .sort((left, right) => right.sequence - left.sequence);
    const attempt = candidates[0] || null;
    const run = attempt
      ? runs.find((entry) => entry.id === attempt.run_id)
      : null;
    const reasons = [];
    if (!attempt || !run) reasons.push('execution:missing');
    if (attempt && run) {
      for (const field of [
        'case_snapshot_hash',
        'code_sha',
        'test_sha',
        'environment_hash',
        'runtime_version',
        'kernel_version'
      ]) {
        if (attempt[field] !== run[field]) reasons.push(`${field}:mismatch`);
      }
    }
    return {
      case_id: testCase.id,
      attempt_id: attempt?.id || 'attempt-missing',
      checked_at: checkedAt,
      status: reasons.length === 0 ? 'fresh' : 'unknown',
      reasons
    };
  });
  const fresh = cases.filter((entry) => entry.status === 'fresh').length;
  const stale = cases.filter((entry) => entry.status === 'stale').length;
  const unknown = cases.length - fresh - stale;
  const blockers = cases.flatMap((entry) => entry.reasons.map((reason) => (
    blocker(
      'verification-production:freshness-incomplete',
      entry.case_id,
      reason
    )
  )));
  return {
    ok: blockers.length === 0,
    checked_at: checkedAt,
    summary: {
      status: blockers.length === 0 ? 'fresh' : 'unknown',
      total: cases.length,
      fresh,
      stale,
      unknown
    },
    cases,
    blockers
  };
}

function gateFreshness(freshness) {
  return {
    status: freshness.summary.status,
    checked_at: freshness.checked_at,
    reasons: stableIds(freshness.cases.flatMap((entry) => entry.reasons))
  };
}

function reportHash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createVerificationArtifactPipeline(options = {}) {
  const {
    kernel,
    schemaRegistry,
    changeRoot,
    verificationRoot,
    snapshot,
    approval,
    clock = () => new Date().toISOString(),
    secrets = [],
    policyVersion = 'verification-v2.0'
  } = options;
  if (
    !kernel
    || !schemaRegistry
    || typeof changeRoot !== 'string'
    || typeof verificationRoot !== 'string'
    || !snapshot
    || !approval
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-production:artifact-config-invalid');
  }
  const store = kernel.createVerificationArtifactStore({
    changeRoot,
    root: verificationRoot
  });

  function build() {
    const blockers = [];
    const runs = readJson(path.join(verificationRoot, 'v2', 'runs.json'), []);
    const attempts = readJson(
      path.join(verificationRoot, 'v2', 'attempts.json'),
      []
    );
    const readings = readJson(
      path.join(verificationRoot, 'v2', 'readings.json'),
      []
    );
    const failures = readJson(
      path.join(verificationRoot, 'v2', 'failures.json'),
      []
    );
    const repairLinks = readJson(
      path.join(verificationRoot, 'v2', 'repair-links.json'),
      []
    );
    const evidenceIndex = readJson(
      path.join(verificationRoot, 'evidence', 'index.json')
    );
    if (!evidenceIndex) {
      return {
        ok: false,
        status: 'blocked',
        blockers: [blocker(
          'verification-production:evidence-index-missing',
          'verify/evidence/index.json'
        )],
        fallback_used: false
      };
    }
    const integrity = mergeIntegrity(verificationRoot, runs, attempts);
    blockers.push(...integrity.blockers);
    const freshness = freshnessProjection(snapshot, runs, attempts, clock());
    blockers.push(...freshness.blockers);
    const aggregationReadings = currentReadings(snapshot, attempts, readings);
    const aggregationRequest = {
      change_id: snapshot.change_id,
      case_ids: snapshot.cases.map((entry) => entry.id),
      readings: aggregationReadings,
      evidence: evidenceIndex.entries,
      integrity,
      policy_facts: {
        not_applicable_decisions: [],
        terminal_states: []
      }
    };
    const aggregator = kernel.createSixDomainAggregator({ schemaRegistry });
    const aggregate = aggregator.aggregate(aggregationRequest);
    blockers.push(...aggregate.blockers);
    const latestRun = [...runs].sort((left, right) => (
      left.completed_at.localeCompare(right.completed_at)
    )).at(-1);
    if (!latestRun) {
      return {
        ok: false,
        status: 'blocked',
        blockers: [blocker(
          'verification-production:runs-missing',
          'verify/v2/runs.json'
        )],
        fallback_used: false
      };
    }
    const openFailureIds = failures.filter((entry) => (
      !['closed', 'resolved'].includes(entry.status)
    )).map((entry) => entry.id);
    const gateInput = {
      schema: 'specnav.verification.release-gate-input.v1',
      change_id: snapshot.change_id,
      lane: 'full',
      case_snapshot_id: snapshot.id,
      case_snapshot_hash: snapshot.snapshot_hash,
      case_approval_id: approval.id,
      case_approval_reviewer_id: approval.reviewer.id,
      aggregation_request: aggregationRequest,
      open_failure_ids: openFailureIds,
      freshness: gateFreshness(freshness),
      integrity_status: integrity.facts.summary.integrity,
      evidence_index_version: evidenceIndex.index_version,
      runtime_version: latestRun.runtime_version,
      kernel_version: latestRun.kernel_version,
      policy_version: policyVersion
    };
    const decisionEngine = kernel.createDecisionEngine({
      schemaRegistry,
      aggregator,
      clock
    });
    const releaseResult = decisionEngine.decide({
      change_id: snapshot.change_id,
      stage: 'release',
      aggregation_request: aggregationRequest,
      open_failure_ids: openFailureIds,
      freshness: gateInput.freshness,
      integrity_status: gateInput.integrity_status,
      evidence_index_version: evidenceIndex.index_version,
      runtime_version: latestRun.runtime_version,
      kernel_version: latestRun.kernel_version,
      policy_version: policyVersion
    });
    const archiveResult = decisionEngine.decide({
      change_id: snapshot.change_id,
      stage: 'archive',
      aggregation_request: aggregationRequest,
      open_failure_ids: openFailureIds,
      freshness: gateInput.freshness,
      integrity_status: gateInput.integrity_status,
      evidence_index_version: evidenceIndex.index_version,
      runtime_version: latestRun.runtime_version,
      kernel_version: latestRun.kernel_version,
      policy_version: policyVersion
    });
    blockers.push(...releaseResult.blockers, ...archiveResult.blockers);
    const rawFile = path.join(verificationRoot, 'evidence', 'raw.jsonl');
    const rawBytes = fs.readFileSync(rawFile);
    const factAuthority = kernel.createReportFactAuthority({
      verifyIntegrity: (payload) => (
        canonicalJson(payload.integrity) === canonicalJson(integrity)
      ),
      verifyFreshness: (payload) => (
        canonicalJson(payload.freshness) === canonicalJson(freshness)
      )
    });
    const builder = kernel.createReportModelBuilder({
      schemaRegistry,
      aggregator,
      decisionEngine,
      evidenceIndexAuthority: kernel.createEvidenceIndexAuthority({
        readRaw: () => rawBytes
      }),
      factAuthority,
      gateContextAuthority: {
        resolve(changeId) {
          return {
            ok: true,
            change_id: changeId,
            stage: 'release',
            policy_version: policyVersion
          };
        }
      },
      secretRedactor: kernel.createSecretRedactor({ secrets }),
      clock
    });
    const report = builder.build({
      change_id: snapshot.change_id,
      case_snapshot: snapshot,
      runs,
      attempts,
      readings,
      evidence_index: evidenceIndex,
      integrity,
      policy_facts: aggregationRequest.policy_facts,
      aggregate,
      freshness,
      failures,
      repair_links: repairLinks,
      gate_decision: releaseResult.gate
    });
    blockers.push(...report.blockers);
    if (!report.model) {
      return {
        ok: false,
        status: 'blocked',
        blockers,
        fallback_used: false
      };
    }
    const rendererOptions = {
      schemaRegistry,
      secretRedactor: kernel.createSecretRedactor({ secrets })
    };
    const rendered = [
      kernel.createOverviewRenderer(rendererOptions).render(report.model),
      kernel.createCaseCatalogRenderer(rendererOptions).render(report.model),
      kernel.createCaseResultsRenderer(rendererOptions).render(report.model)
    ];
    blockers.push(...rendered.flatMap((entry) => entry.blockers || []));
    const writes = [
      store.publishJson('v2/freshness.json', freshness),
      store.publishJson('v2/integrity.json', integrity),
      store.publishJson('v2/aggregate.json', aggregate),
      store.publishJson('v2/gate-input.json', gateInput),
      ...(releaseResult.gate
        ? [store.publishJson('v2/release-gate.json', releaseResult.gate)]
        : []),
      ...(archiveResult.gate
        ? [store.publishJson('v2/archive-gate.json', archiveResult.gate)]
        : []),
      store.publishJson('v2/report-model.json', report.model)
    ];
    const reportManifest = {
      schema: 'specnav.verification.report-render-manifest.v1',
      change_id: snapshot.change_id,
      report_model_id: report.model.id,
      generated_at: clock(),
      reports: []
    };
    for (const entry of rendered) {
      if (!entry.ok) continue;
      const bytes = Buffer.from(entry.html);
      writes.push(store.publishText(`reports/${entry.file_name}`, entry.html));
      reportManifest.reports.push({
        name: entry.file_name,
        path: `verify/reports/${entry.file_name}`,
        sha256: reportHash(bytes),
        size: bytes.length
      });
    }
    writes.push(store.publishJson('v2/report-render-manifest.json', {
      ...reportManifest,
      reports: reportManifest.reports.sort((left, right) => (
        left.name.localeCompare(right.name)
      ))
    }));
    blockers.push(...writes.flatMap((entry) => (
      entry.ok ? [] : entry.blockers
    )));
    if (reportManifest.reports.length !== REPORT_FILES.length) {
      blockers.push(blocker(
        'verification-production:report-set-incomplete',
        'verify/reports'
      ));
    }
    return {
      ok: blockers.length === 0
        && releaseResult.ok
        && archiveResult.ok
        && report.ok,
      status: blockers.length === 0 && releaseResult.ok
        ? 'pass'
        : 'blocked',
      aggregate,
      gate_input: gateInput,
      release_gate: releaseResult.gate,
      archive_gate: archiveResult.gate,
      report_model: report.model,
      report_manifest: reportManifest,
      blockers,
      fallback_used: false
    };
  }

  return Object.freeze({ build });
}

module.exports = {
  REPORT_FILES,
  createVerificationArtifactPipeline,
  freshnessProjection,
  mergeIntegrity
};
