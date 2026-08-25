'use strict';

const crypto = require('node:crypto');

const {
  canonicalJson,
  sha256
} = require('../evidence/identity');
const {
  createAuthorityLog
} = require('../repair/authority-log');

const REPORT_FILES = Object.freeze([
  'overview.html',
  'test-case-catalog.html',
  'test-case-results.html'
]);

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function readJson(store, relative, fallback, blockers) {
  const bytes = store.readBytes(relative);
  if (!bytes.ok) {
    blockers.push(...bytes.blockers);
    return structuredClone(fallback);
  }
  if (bytes.missing) return structuredClone(fallback);
  try {
    return JSON.parse(bytes.bytes.toString('utf8'));
  } catch (error) {
    blockers.push(blocker(
      'verification-production:json-invalid',
      relative,
      error instanceof Error ? error.message : String(error)
    ));
    return structuredClone(fallback);
  }
}

function readJsonl(store, relative, blockers) {
  const result = store.readJsonl(relative);
  if (!result.ok) {
    blockers.push(...result.blockers);
    return [];
  }
  return result.value;
}

function readOptionalJson(store, relative, blockers) {
  const result = store.readBytes(relative);
  if (!result.ok) {
    blockers.push(...result.blockers);
    return { exists: false, value: null };
  }
  if (result.missing) return { exists: false, value: null };
  try {
    return {
      exists: true,
      value: JSON.parse(result.bytes.toString('utf8'))
    };
  } catch (error) {
    blockers.push(blocker(
      'verification-production:json-invalid',
      relative,
      error instanceof Error ? error.message : String(error)
    ));
    return { exists: true, value: null };
  }
}

function rawFailureInventory(
  store,
  runs,
  blockers,
  options = {}
) {
  const inventoryBlockers = [];
  const inventory = store.listDirectory('runs');
  if (!inventory.ok) {
    inventoryBlockers.push(...inventory.blockers);
    blockers.push(...inventoryBlockers);
    return { values: [], blockers: inventoryBlockers };
  }
  const indexedRunIds = new Set(runs.map((run) => run?.id).filter(Boolean));
  const directoryRunIds = new Set();
  for (const entry of inventory.entries) {
    if (entry.type !== 'directory') {
      inventoryBlockers.push(blocker(
        'verification-production:run-inventory-invalid',
        `runs/${entry.name}`,
        entry.type
      ));
      continue;
    }
    directoryRunIds.add(entry.name);
    if (!indexedRunIds.has(entry.name) && options.ignoreUnindexed !== true) {
      inventoryBlockers.push(blocker(
        'verification-production:run-unindexed',
        `runs/${entry.name}`
      ));
    }
  }
  for (const runId of indexedRunIds) {
    if (!directoryRunIds.has(runId)) {
      inventoryBlockers.push(blocker(
        'verification-production:run-directory-missing',
        `runs/${runId}`
      ));
    }
  }
  const values = [...directoryRunIds].filter((runId) => (
    indexedRunIds.has(runId)
  )).sort().flatMap((runId) => readJsonl(
    store,
    `runs/${runId}/failures.jsonl`,
    inventoryBlockers
  ));
  blockers.push(...inventoryBlockers);
  return { values, blockers: inventoryBlockers };
}

function stableIds(values) {
  return [...new Set(values)].sort();
}

function compareAttempts(left, right) {
  return String(left.completed_at || '').localeCompare(
      String(right.completed_at || '')
    )
    || String(left.started_at || '').localeCompare(
      String(right.started_at || '')
    )
    || left.sequence - right.sequence
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

function mergeIntegrity(store, runs, attempts) {
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
      const file = [
        'runs',
        run.id,
        'attempts',
        attempt.id,
        'integrity.json'
      ].join('/');
      const value = readJson(store, file, null, blockers);
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
    const runFile = [
      'runs',
      run.id,
      'integrity.json'
    ].join('/');
    const runValue = readJson(store, runFile, null, blockers);
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

function freshnessProjection(
  snapshot,
  runs,
  attempts,
  currentFingerprints,
  checkedAt
) {
  const cases = snapshot.cases.map((testCase) => {
    const candidates = attempts.filter((entry) => entry.case_id === testCase.id)
      .sort(compareAttempts);
    const attempt = candidates.at(-1) || null;
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
        if (run[field] !== currentFingerprints[field]) {
          reasons.push(`${field}:current-mismatch`);
        }
      }
    }
    const missing = reasons.includes('execution:missing');
    return {
      case_id: testCase.id,
      attempt_id: attempt?.id || 'attempt-missing',
      checked_at: checkedAt,
      status: reasons.length === 0
        ? 'fresh'
        : missing
          ? 'unknown'
          : 'stale',
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

function scopedEvidenceIndex(index, runIds, activatedAt) {
  const entries = (index.entries || []).filter((entry) => (
    runIds.has(entry.run_id)
  )).sort((left, right) => (
    String(left.captured_at).localeCompare(String(right.captured_at))
    || String(left.id).localeCompare(String(right.id))
  ));
  const rawBytes = Buffer.from(
    entries.length === 0
      ? ''
      : `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  return {
    rawBytes,
    index: {
      schema: 'specnav.verification.evidence-index.v1',
      index_version: Math.max(1, entries.length),
      change_id: index.change_id,
      generated_at: entries.at(-1)?.captured_at || activatedAt,
      source_raw: 'raw.jsonl',
      source_digest: sha256(rawBytes),
      record_count: entries.length,
      entries
    }
  };
}

function createVerificationArtifactPipeline(options = {}) {
  const {
    kernel,
    schemaRegistry,
    changeRoot,
    verificationRoot,
    snapshot,
    approval,
    currentFingerprints,
    activeGeneration,
    trustedFactAuthority,
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
    || !currentFingerprints
    || typeof currentFingerprints !== 'object'
    || !activeGeneration
    || typeof activeGeneration.id !== 'string'
    || !trustedFactAuthority
    || typeof trustedFactAuthority.verify !== 'function'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-production:artifact-config-invalid');
  }
  const store = kernel.createVerificationArtifactStore({
    changeRoot,
    root: verificationRoot
  });

  function build(buildOptions = {}) {
    const persist = buildOptions.persist !== false;
    const blockers = [];
    let runs = readJson(store, 'v2/runs.json', [], blockers);
    let attempts = readJson(
      store,
      'v2/attempts.json',
      [],
      blockers
    );
    const executions = readJson(
      store,
      'v2/executions.json',
      [],
      blockers
    );
    let readings = readJson(
      store,
      'v2/readings.json',
      [],
      blockers
    );
    let failures = readJson(
      store,
      'v2/failures.json',
      [],
      blockers
    );
    let repairLinks = readJson(
      store,
      'v2/repair-links.json',
      [],
      blockers
    );
    const authorityLog = createAuthorityLog({
      store,
      authority: trustedFactAuthority
    });
    const proposalLog = authorityLog.validate(
      'v2/transition-proposals.jsonl',
      'transition_proposal'
    );
    const receiptLog = authorityLog.validate(
      'v2/transition-receipts.jsonl',
      'transition_application'
    );
    const attemptFactLog = authorityLog.validate(
      'v2/attempt-facts.jsonl',
      'attempt_fact'
    );
    blockers.push(
      ...(proposalLog.blockers || []),
      ...(receiptLog.blockers || []),
      ...(attemptFactLog.blockers || [])
    );
    const authorityLogs = {
      transition_proposals: proposalLog,
      transition_receipts: receiptLog,
      attempt_facts: attemptFactLog
    };
    const existingAnchor = readOptionalJson(
      store,
      'v2/authority-chain-anchor.json',
      blockers
    );
    const priorGateInput = readOptionalJson(
      store,
      'v2/gate-input.json',
      blockers
    );
    if (existingAnchor.exists) {
      const anchorValidation = authorityLog.validateAnchor(
        existingAnchor.value,
        snapshot.change_id,
        authorityLogs
      );
      blockers.push(...anchorValidation.blockers);
    } else if (priorGateInput.exists || buildOptions.persist === false) {
      blockers.push(blocker(
        'verification-authority-log:anchor-missing',
        'v2/authority-chain-anchor.json'
      ));
    }
    const evidenceIndex = readJson(
      store,
      'evidence/index.json',
      null,
      blockers
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
    const baseline = kernel.verifyBaseline(activeGeneration.baseline, {
      runs,
      attempts,
      executions,
      readings,
      failures,
      repair_links: repairLinks,
      evidence: evidenceIndex.entries,
      transition_proposals: proposalLog.value || [],
      transition_receipts: receiptLog.value || [],
      attempt_facts: attemptFactLog.value || []
    });
    blockers.push(...baseline.blockers);
    if (
      activeGeneration.change_id !== snapshot.change_id
      || activeGeneration.snapshot_id !== snapshot.id
      || activeGeneration.snapshot_hash !== snapshot.snapshot_hash
      || canonicalJson(activeGeneration.fingerprints)
        !== canonicalJson(currentFingerprints)
    ) {
      blockers.push(blocker(
        'verification-generation:active-binding-mismatch',
        activeGeneration.id
      ));
    }
    if (
      !baseline.ok
      || blockers.some((entry) => (
        entry.id === 'verification-generation:active-binding-mismatch'
      ))
    ) {
      return {
        ok: false,
        status: 'blocked',
        blockers,
        fallback_used: false
      };
    }
    const generationRunIds = new Set(runs.filter((entry) => (
      entry.generation_id === activeGeneration.id
    )).map((entry) => entry.id));
    runs = runs.filter((entry) => generationRunIds.has(entry.id));
    attempts = attempts.filter((entry) => generationRunIds.has(entry.run_id));
    readings = readings.filter((entry) => generationRunIds.has(entry.run_id));
    failures = failures.filter((entry) => generationRunIds.has(entry.run_id));
    const generationFailureIds = new Set(failures.map((entry) => entry.id));
    repairLinks = repairLinks.filter((entry) => (
      generationFailureIds.has(entry.failure_id)
    ));
    const generationEvidence = scopedEvidenceIndex(
      evidenceIndex,
      generationRunIds,
      activeGeneration.activated_at
    );
    const scopedIndexValidation = schemaRegistry.validate(
      'evidence-index',
      generationEvidence.index
    );
    if (!scopedIndexValidation.ok) {
      blockers.push(...scopedIndexValidation.blockers);
    }
    const currentEvidenceIndex = scopedIndexValidation.ok
      ? scopedIndexValidation.value
      : generationEvidence.index;
    const classificationEnvelopes = failures.map((failure) => readJson(
      store,
      `repairs/${failure.id}/classification-envelope.json`,
      null,
      blockers
    )).filter(Boolean);
    const rawFailureState = rawFailureInventory(
      store,
      runs,
      blockers,
      { ignoreUnindexed: true }
    );
    const rawFailures = rawFailureState.values;
    const integrity = mergeIntegrity(store, runs, attempts);
    blockers.push(...integrity.blockers);
    const freshness = freshnessProjection(
      snapshot,
      runs,
      attempts,
      currentFingerprints,
      clock()
    );
    blockers.push(...freshness.blockers);
    const aggregationReadings = currentReadings(snapshot, attempts, readings);
    const aggregationRequest = {
      change_id: snapshot.change_id,
      case_ids: snapshot.cases.map((entry) => entry.id),
      readings: aggregationReadings,
      evidence: currentEvidenceIndex.entries,
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
    const failureState = kernel.createFailureStateReducer({
      schemaRegistry,
      trustVerifier: trustedFactAuthority
    }).reduce({
      expected_change_id: snapshot.change_id,
      failures,
      raw_failures: rawFailures,
      runs,
      classification_envelopes: classificationEnvelopes,
      transition_proposal_envelopes: (proposalLog.value || []).filter(
        (entry) => generationFailureIds.has(entry.bindings?.failure_id)
      ),
      transition_receipt_envelopes: (receiptLog.value || []).filter(
        (entry) => generationFailureIds.has(entry.bindings?.failure_id)
      )
    });
    blockers.push(...failureState.blockers);
    const openFailureIds = failureState.open_failure_ids;
    const failureStateStatus = failureState.ok
      && rawFailureState.blockers.length === 0
      && proposalLog.ok
      && receiptLog.ok
      && attemptFactLog.ok
      ? 'valid'
      : 'invalid';
    const failureStateDigest = sha256(canonicalJson(failureState));
    const authorityHeads = {
      transition_proposals: authorityLog.logHead(
        'v2/transition-proposals.jsonl',
        'transition_proposal',
        proposalLog
      ),
      transition_receipts: authorityLog.logHead(
        'v2/transition-receipts.jsonl',
        'transition_application',
        receiptLog
      ),
      attempt_facts: authorityLog.logHead(
        'v2/attempt-facts.jsonl',
        'attempt_fact',
        attemptFactLog
      )
    };
    const existingAnchorMatches = existingAnchor.value
      && trustedFactAuthority.verifyChainAnchor(existingAnchor.value).ok
      && canonicalJson(existingAnchor.value.logs)
        === canonicalJson(authorityHeads);
    const authorityAnchor = existingAnchorMatches
      ? existingAnchor.value
      : trustedFactAuthority.sealChainAnchor({
          change_id: snapshot.change_id,
          logs: authorityHeads
        });
    const authorityChainDigest = sha256(canonicalJson({
      anchor_id: authorityAnchor.id,
      logs: authorityHeads,
      generation_id: activeGeneration.id,
      generation_digest: sha256(canonicalJson(activeGeneration))
    }));
    const gateInput = {
      schema: 'specnav.verification.release-gate-input.v1',
      change_id: snapshot.change_id,
      lane: 'full',
      case_snapshot_id: snapshot.id,
      case_snapshot_hash: snapshot.snapshot_hash,
      case_approval_id: approval.id,
      case_approval_reviewer_id: approval.reviewer.id,
      generation_id: activeGeneration.id,
      aggregation_request: aggregationRequest,
      open_failure_ids: openFailureIds,
      failure_state_status: failureStateStatus,
      failure_state_digest: failureStateDigest,
      authority_chain_digest: authorityChainDigest,
      freshness: gateFreshness(freshness),
      integrity_status: integrity.facts.summary.integrity,
      evidence_index_version: currentEvidenceIndex.index_version,
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
      failure_state_status: failureStateStatus,
      failure_state_digest: failureStateDigest,
      authority_chain_digest: authorityChainDigest,
      freshness: gateInput.freshness,
      integrity_status: gateInput.integrity_status,
      evidence_index_version: currentEvidenceIndex.index_version,
      runtime_version: latestRun.runtime_version,
      kernel_version: latestRun.kernel_version,
      policy_version: policyVersion
    });
    const archiveResult = decisionEngine.decide({
      change_id: snapshot.change_id,
      stage: 'archive',
      aggregation_request: aggregationRequest,
      open_failure_ids: openFailureIds,
      failure_state_status: failureStateStatus,
      failure_state_digest: failureStateDigest,
      authority_chain_digest: authorityChainDigest,
      freshness: gateInput.freshness,
      integrity_status: gateInput.integrity_status,
      evidence_index_version: currentEvidenceIndex.index_version,
      runtime_version: latestRun.runtime_version,
      kernel_version: latestRun.kernel_version,
      policy_version: policyVersion
    });
    blockers.push(...releaseResult.blockers, ...archiveResult.blockers);
    const rawBytes = generationEvidence.rawBytes;
    const factAuthority = kernel.createReportFactAuthority({
      verifyIntegrity: (payload) => (
        canonicalJson(payload.integrity) === canonicalJson(integrity)
      ),
      verifyFreshness: (payload) => (
        canonicalJson(payload.freshness) === canonicalJson(freshness)
      ),
      verifyGateFacts: (payload) => (
        payload.failure_state_status === failureStateStatus
        && payload.failure_state_digest === failureStateDigest
        && payload.authority_chain_digest === authorityChainDigest
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
      generation_id: activeGeneration.id,
      case_snapshot: snapshot,
      runs,
      attempts,
      readings,
      evidence_index: currentEvidenceIndex,
      integrity,
      policy_facts: aggregationRequest.policy_facts,
      aggregate,
      freshness,
      failures: failureState.effective_failures,
      repair_links: repairLinks,
      failure_state_status: failureStateStatus,
      failure_state_digest: failureStateDigest,
      authority_chain_digest: authorityChainDigest,
      gate_decision: releaseResult.gate,
      historical_warnings: activeGeneration
        .historical_break_loop_failure_ids.map((failureId) => blocker(
          'verification-generation:historical-break-loop',
          failureId,
          activeGeneration.id
        ))
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
    const writes = persist
      ? [
          store.publishJson('v2/freshness.json', freshness),
          store.publishJson('v2/integrity.json', integrity),
          store.publishJson('v2/failure-state.json', failureState),
          store.publishJson(
            'v2/authority-chain-anchor.json',
            authorityAnchor
          ),
          store.publishJson('v2/aggregate.json', aggregate),
          store.publishJson('v2/gate-input.json', gateInput),
          ...(releaseResult.gate
            ? [store.publishJson('v2/release-gate.json', releaseResult.gate)]
            : []),
          ...(archiveResult.gate
            ? [store.publishJson('v2/archive-gate.json', archiveResult.gate)]
            : []),
          store.publishJson('v2/report-model.json', report.model)
        ]
      : [];
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
      if (persist) {
        writes.push(store.publishText(
          `reports/${entry.file_name}`,
          entry.html
        ));
      }
      reportManifest.reports.push({
        name: entry.file_name,
        path: `verify/reports/${entry.file_name}`,
        sha256: reportHash(bytes),
        size: bytes.length
      });
    }
    if (persist) {
      writes.push(store.publishJson('v2/report-render-manifest.json', {
        ...reportManifest,
        reports: reportManifest.reports.sort((left, right) => (
          left.name.localeCompare(right.name)
        ))
      }));
    }
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
      freshness,
      integrity,
      failure_state: failureState,
      authority_chain_anchor: authorityAnchor,
      gate_input: gateInput,
      release_gate: releaseResult.gate,
      archive_gate: archiveResult.gate,
      report_model: report.model,
      report_manifest: reportManifest,
      generation: activeGeneration,
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
