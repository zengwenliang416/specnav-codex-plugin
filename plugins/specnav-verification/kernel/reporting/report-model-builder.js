'use strict';

const path = require('node:path');
const { deepFreeze } = require('../contracts/schema-registry');
const {
  computeSnapshotHash
} = require('../cases/snapshot-writer');
const {
  createCrossReferenceValidator
} = require('../contracts/cross-reference-validator');
const {
  canonicalJson,
  sha256
} = require('../evidence/identity');
const {
  isSecretRedactor
} = require('../evidence/secret-redactor');
const { SIX_DOMAINS } = require('../evaluation/terminal-state');
const {
  byAttempt,
  byId,
  byRun,
  commandProjection,
  isRecord,
  stableBlockers,
  stableIds
} = require('./report-selectors');
const {
  resolveEvidenceLinks
} = require('./evidence-link-resolver');
const {
  isEvidenceIndexAuthority,
  isReportFactAuthority
} = require('./report-authorities');

const FAILURE_OPEN = new Set([
  'open',
  'classified',
  'repair_required',
  'retry_allowed',
  'blocked_for_decision',
  'fixed',
  'reopened',
  'break_loop'
]);
const REPAIR_OPEN = new Set(['requested', 'in_progress', 'reviewed']);
const EVIDENCE_RAW_ARTIFACT = 'raw.jsonl';

function blocker(id, artifact = null, detail = null) {
  return { id, artifact, detail };
}

function digestValue(value) {
  try {
    return sha256(canonicalJson(value === undefined ? null : value));
  } catch {
    return null;
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateOne(schemaRegistry, type, value, blockers) {
  if (!isRecord(value)) return null;
  const result = schemaRegistry.validate(type, value);
  if (!result.ok) {
    blockers.push(blocker(
      'verification-report:source-schema-invalid',
      value.id || type,
      result.blockers
    ));
    return null;
  }
  return result.value;
}

function validateMany(schemaRegistry, type, values, blockers) {
  if (!Array.isArray(values)) return [];
  const output = [];
  const ids = new Set();
  for (const value of values) {
    const valid = validateOne(schemaRegistry, type, value, blockers);
    if (!valid) continue;
    if (ids.has(valid.id)) {
      blockers.push(blocker(
        'verification-report:duplicate-id',
        valid.id,
        type
      ));
      continue;
    }
    ids.add(valid.id);
    output.push(valid);
  }
  return output.sort(type === 'attempt' ? byAttempt : byId);
}

function validateAggregate(value, changeId, blockers) {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || value.change_id !== changeId
    || !Array.isArray(value.case_results)
    || !Array.isArray(value.domain_results)
    || !isRecord(value.release)
    || !Array.isArray(value.source_case_ids)
    || !Array.isArray(value.source_reading_ids)
    || !Array.isArray(value.blockers)
  ) {
    blockers.push(blocker(
      'verification-report:aggregate-invalid',
      value.id || 'aggregate'
    ));
    return null;
  }
  const identity = {
    change_id: value.change_id,
    case_results: value.case_results.map((entry) => ({
      case_id: entry.case_id,
      status: entry.status,
      domains: Object.fromEntries(SIX_DOMAINS.map((domain) => [
        domain,
        entry.domains?.[domain]?.status
      ]))
    })),
    release: value.release,
    blockers: value.blockers
  };
  if (
    value.id !== `verification-aggregate-${sha256(canonicalJson(identity))}`
  ) {
    blockers.push(blocker(
      'verification-report:aggregate-digest-mismatch',
      value.id
    ));
    return null;
  }
  return structuredClone(value);
}

function aggregateRequest(input) {
  return {
    change_id: input.changeId,
    case_ids: stableIds((input.caseSnapshot?.cases || []).map((entry) => (
      entry.id
    ))),
    readings: input.readings,
    evidence: input.evidence,
    integrity: input.integrity,
    policy_facts: isRecord(input.policyFacts)
      ? input.policyFacts
      : {
          not_applicable_decisions: [],
          terminal_states: []
        }
  };
}

function currentReadings(caseSnapshot, attempts, readings) {
  const latestByCase = new Map();
  for (const testCase of caseSnapshot?.cases || []) {
    const latest = attempts.filter((entry) => entry.case_id === testCase.id)
      .sort(byAttempt)
      .at(-1);
    if (latest) latestByCase.set(testCase.id, latest.id);
  }
  return readings.filter((entry) => (
    latestByCase.get(entry.case_id) === entry.attempt_id
  ));
}

function attemptHasReadings(attempt, readings) {
  return readings.some((entry) => entry.attempt_id === attempt.id);
}

function validateTerminalFacts(input, blockers) {
  const {
    requestedFacts,
    attempts,
    readings,
    aggregationReadings,
    failures,
    repairLinks,
    freshness
  } = input;
  const attemptsById = new Map(attempts.map((entry) => [entry.id, entry]));
  const failuresById = new Map(failures.map((entry) => [entry.id, entry]));
  const facts = [];
  for (const fact of Array.isArray(requestedFacts) ? requestedFacts : []) {
    const caseAttempts = attempts.filter((entry) => (
      entry.case_id === fact?.case_id
    )).sort(byAttempt);
    const latest = caseAttempts.at(-1);
    const sources = stableIds(readings.filter((entry) => (
      entry.case_id === fact?.case_id
      && entry.attempt_id === latest?.id
    )).map((entry) => entry.id));
    let valid = false;
    if (fact?.status === 'canceled') {
      valid = latest?.status === 'canceled';
    } else if (fact?.status === 'stale') {
      valid = Array.isArray(freshness?.cases)
        && freshness.cases.some((entry) => (
        entry.case_id === fact.case_id && entry.status === 'stale'
        ));
    } else if (fact?.status === 'flaky') {
      const parent = attemptsById.get(latest?.parent_attempt_id);
      valid = latest?.kind === 'retry'
        && latest.status === 'passed'
        && parent?.status === 'failed'
        && attemptHasReadings(latest, readings);
    } else if (fact?.status === 'pass_after_fix') {
      const regression = latest;
      const retest = attemptsById.get(regression?.parent_attempt_id);
      const failed = attemptsById.get(retest?.parent_attempt_id);
      const failure = failures.find((entry) => (
        entry.case_id === fact.case_id
        && entry.attempt_id === failed?.id
        && !FAILURE_OPEN.has(entry.status)
      ));
      const repair = repairLinks.find((entry) => (
        entry.failure_id === failure?.id
        && entry.status === 'completed'
      ));
      valid = regression?.kind === 'regression'
        && regression.status === 'passed'
        && retest?.kind === 'retest'
        && retest.status === 'passed'
        && failed?.status === 'failed'
        && Boolean(failuresById.get(failure?.id))
        && Boolean(repair)
        && [failed, retest, regression].every((entry) => (
          attemptHasReadings(entry, readings)
        ));
    }
    if (
      !valid
      || !Array.isArray(fact?.source_reading_ids)
      || canonicalJson(stableIds(fact.source_reading_ids))
        !== canonicalJson(sources)
    ) {
      blockers.push(blocker(
        'verification-report:terminal-state-unverified',
        fact?.id || fact?.case_id || 'terminal-state',
        fact?.status || null
      ));
      continue;
    }
    facts.push({
      ...fact,
      source_reading_ids: sources
    });
  }
  return facts;
}

function recomputeAggregate(options) {
  const {
    aggregator,
    candidate,
    request,
    changeId,
    blockers
  } = options;
  let computed;
  try {
    computed = aggregator.aggregate(request);
  } catch {
    computed = null;
  }
  const trusted = validateAggregate(computed, changeId, blockers);
  if (!trusted) {
    blockers.push(blocker(
      'verification-report:aggregate-authority-invalid',
      candidate?.id || changeId
    ));
    return null;
  }
  if (!candidate || canonicalJson(candidate) !== canonicalJson(trusted)) {
    blockers.push(blocker(
      'verification-report:aggregate-authority-mismatch',
      candidate?.id || trusted.id,
      trusted.id
    ));
  }
  return trusted;
}

function gateSemantic(value) {
  if (!isRecord(value)) return null;
  return {
    change_id: value.change_id,
    stage: value.stage,
    decision: value.decision,
    source_case_ids: value.source_case_ids,
    source_reading_ids: value.source_reading_ids,
    failure_state_status: value.failure_state_status,
    failure_state_digest: value.failure_state_digest,
    authority_chain_digest: value.authority_chain_digest,
    evidence_index_version: value.evidence_index_version,
    runtime_version: value.runtime_version,
    kernel_version: value.kernel_version,
    freshness: value.freshness,
    integrity_status: value.integrity_status,
    policy_version: value.policy_version,
    blockers: value.blockers,
    warnings: value.warnings
  };
}

function recomputeGate(options) {
  const {
    schemaRegistry,
    decisionEngine,
    candidate,
    aggregationRequest,
    evidenceIndex,
    freshness,
    integrity,
    failures,
    runs,
    changeId,
    gateContext,
    gateFacts,
    blockers
  } = options;
  if (!candidate || !gateContext) return null;
  const latestRun = [...runs].sort(byRun).at(-1);
  let result;
  try {
    result = decisionEngine.decide({
      change_id: changeId,
      stage: gateContext.stage,
      aggregation_request: aggregationRequest,
      evidence_index_version: evidenceIndex?.index_version,
      runtime_version: latestRun?.runtime_version
        || candidate.runtime_version,
      kernel_version: latestRun?.kernel_version
        || candidate.kernel_version,
      freshness,
      integrity_status: integrity,
      policy_version: gateContext.policy_version,
      failure_state_status: gateFacts.failure_state_status,
      failure_state_digest: gateFacts.failure_state_digest,
      authority_chain_digest: gateFacts.authority_chain_digest,
      open_failure_ids: stableIds(failures.filter((entry) => (
        FAILURE_OPEN.has(entry.status)
      )).map((entry) => entry.id))
    });
  } catch {
    result = null;
  }
  const trusted = validateOne(
    schemaRegistry,
    'gate-decision',
    result?.gate,
    blockers
  );
  if (!trusted) {
    blockers.push(blocker(
      'verification-report:gate-authority-invalid',
      candidate.id
    ));
    return null;
  }
  if (
    candidate.id !== trusted.id
    || canonicalJson(gateSemantic(candidate))
      !== canonicalJson(gateSemantic(trusted))
  ) {
    blockers.push(blocker(
      'verification-report:gate-authority-mismatch',
      candidate.id,
      trusted.id
    ));
  }
  return trusted;
}

function resolveGateContext(authority, changeId, blockers) {
  let result;
  try {
    result = authority.resolve(changeId);
  } catch {
    result = null;
  }
  if (
    !isRecord(result)
    || result.ok !== true
    || result.change_id !== changeId
    || !['verification', 'release', 'archive'].includes(result.stage)
    || typeof result.policy_version !== 'string'
    || result.policy_version.length === 0
  ) {
    blockers.push(blocker(
      'verification-report:gate-context-unverified',
      changeId
    ));
    return null;
  }
  return {
    change_id: result.change_id,
    stage: result.stage,
    policy_version: result.policy_version
  };
}

function verifyEvidenceIndex(verifier, index, changeId, blockers) {
  if (!index) return false;
  let result;
  try {
    result = verifier.verify(index);
  } catch {
    result = null;
  }
  const expectedIds = index.entries.map((entry) => entry.id).sort();
  const expectedEntriesDigest = sha256(canonicalJson(index.entries));
  if (
    index.change_id !== changeId
    || index.source_raw !== EVIDENCE_RAW_ARTIFACT
    || !isRecord(result)
    || result.ok !== true
    || result.change_id !== index.change_id
    || result.source_raw !== index.source_raw
    || result.index_version !== index.index_version
    || result.source_digest !== index.source_digest
    || result.entries_digest !== expectedEntriesDigest
    || result.record_count !== index.record_count
    || !Array.isArray(result.entry_ids)
    || canonicalJson(result.entry_ids) !== canonicalJson(expectedIds)
  ) {
    blockers.push(blocker(
      'verification-report:evidence-index-unverified',
      index.source_raw,
      index.source_digest
    ));
    return false;
  }
  return true;
}

function verifyFactAuthority(options) {
  const {
    authority,
    method,
    payload,
    expected,
    blockerId,
    artifact,
    blockers
  } = options;
  let result;
  try {
    result = authority[method](structuredClone(payload));
  } catch {
    result = null;
  }
  if (
    !isRecord(result)
    || result.ok !== true
    || Object.entries(expected).some(([key, value]) => (
      canonicalJson(result[key]) !== canonicalJson(value)
    ))
  ) {
    blockers.push(blocker(blockerId, artifact));
    return false;
  }
  return true;
}

function crossReferenceBlockers(validator, input) {
  const {
    changeId,
    caseSnapshot,
    runs,
    attempts,
    readings,
    evidence
  } = input;
  if (!caseSnapshot) return [];
  const blockers = [];
  for (const run of runs) {
    let result;
    try {
      result = validator.validateCrossReferences({
        activeChangeId: changeId,
        caseSnapshot,
        run,
        attempts: attempts.filter((entry) => entry.run_id === run.id),
        readings: readings.filter((entry) => entry.run_id === run.id),
        evidence: evidence.filter((entry) => entry.run_id === run.id)
      });
    } catch {
      result = null;
    }
    if (!isRecord(result) || result.ok !== true) {
      const source = Array.isArray(result?.blockers) ? result.blockers : [];
      if (source.length === 0) {
        blockers.push(blocker(
          'verification-report:cross-reference-invalid',
          run.id
        ));
      } else {
        for (const entry of source) {
          blockers.push(blocker(
            'verification-report:cross-reference-invalid',
            entry.entity_id || run.id,
            entry
          ));
        }
      }
    }
  }
  return blockers;
}

function duplicateEvidenceIds(evidence) {
  const seen = new Set();
  const duplicates = [];
  for (const entry of evidence) {
    if (seen.has(entry.id)) duplicates.push(entry.id);
    seen.add(entry.id);
  }
  return stableIds(duplicates);
}

function sourceBindings(input) {
  const {
    changeId,
    caseSnapshot,
    evidenceIndex,
    runs,
    attempts,
    readings,
    aggregationReadings,
    evidence,
    failures,
    repairLinks,
    aggregate,
    freshness,
    gateDecision
  } = input;
  const blockers = [];
  const cases = new Map((caseSnapshot?.cases || []).map((entry) => [
    entry.id,
    entry
  ]));
  const runsById = new Map(runs.map((entry) => [entry.id, entry]));
  const attemptsById = new Map(attempts.map((entry) => [entry.id, entry]));
  const readingsById = new Map(readings.map((entry) => [entry.id, entry]));
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  const failuresById = new Map(failures.map((entry) => [entry.id, entry]));

  for (const artifact of [
    caseSnapshot,
    evidenceIndex,
    ...runs,
    ...attempts,
    ...readings,
    ...evidence,
    ...failures,
    ...repairLinks,
    gateDecision
  ].filter(Boolean)) {
    if (
      Object.hasOwn(artifact, 'change_id')
      && artifact.change_id !== changeId
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        artifact.id || (
          artifact === evidenceIndex ? 'evidence-index' : 'source'
        ),
        'change_id'
      ));
    }
  }
  for (const run of runs) {
    if (
      !caseSnapshot
      || run.case_snapshot_id !== caseSnapshot.id
      || run.case_snapshot_hash !== caseSnapshot.snapshot_hash
      || run.case_ids.some((id) => !cases.has(id))
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        run.id,
        'case_snapshot'
      ));
    }
  }
  for (const attempt of attempts) {
    const run = runsById.get(attempt.run_id);
    if (
      !run
      || !cases.has(attempt.case_id)
      || attempt.case_snapshot_hash !== caseSnapshot?.snapshot_hash
      || run.code_sha !== attempt.code_sha
      || run.test_sha !== attempt.test_sha
      || run.environment_hash !== attempt.environment_hash
      || run.runtime_version !== attempt.runtime_version
      || run.kernel_version !== attempt.kernel_version
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        attempt.id,
        'attempt'
      ));
    }
  }
  for (const reading of readings) {
    const attempt = attemptsById.get(reading.attempt_id);
    if (
      !runsById.has(reading.run_id)
      || !cases.has(reading.case_id)
      || !attempt
      || attempt.run_id !== reading.run_id
      || attempt.case_id !== reading.case_id
      || attempt.code_sha !== reading.code_sha
      || attempt.test_sha !== reading.test_sha
      || reading.evidence_ids.some((id) => !evidenceById.has(id))
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        reading.id,
        'reading'
      ));
    }
  }
  for (const entry of evidence) {
    const attempt = attemptsById.get(entry.attempt_id);
    const boundReadings = readings.filter((reading) => (
      reading.evidence_ids.includes(entry.id)
    ));
    if (
      !attempt
      || attempt.run_id !== entry.run_id
      || attempt.case_id !== entry.case_id
      || attempt.code_sha !== entry.code_sha
      || attempt.test_sha !== entry.test_sha
      || attempt.environment_hash !== entry.environment_hash
      || attempt.runtime_version !== entry.runtime_version
      || attempt.kernel_version !== entry.kernel_version
      || boundReadings.length === 0
      || boundReadings.some((reading) => (
        reading.run_id !== entry.run_id
        || reading.case_id !== entry.case_id
        || reading.attempt_id !== entry.attempt_id
        || reading.code_sha !== entry.code_sha
        || reading.test_sha !== entry.test_sha
        || (
          entry.domain !== undefined
          && entry.domain !== reading.domain
        )
        || (
          entry.step_id !== undefined
          && entry.step_id !== reading.step_id
        )
        || (
          entry.assertion_id !== undefined
          && entry.assertion_id !== reading.assertion_id
        )
      ))
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        entry.id,
        'evidence'
      ));
    }
  }
  for (const failure of failures) {
    const run = runsById.get(failure.run_id);
    const attempt = attemptsById.get(failure.attempt_id);
    const boundReadings = failure.reading_ids.map((id) => readingsById.get(id));
    const boundEvidence = failure.evidence_ids.map((id) => evidenceById.get(id));
    if (
      !run
      || !cases.has(failure.case_id)
      || !attempt
      || attempt.run_id !== failure.run_id
      || attempt.case_id !== failure.case_id
      || boundReadings.some((reading) => (
        !reading
        || reading.run_id !== failure.run_id
        || reading.case_id !== failure.case_id
        || reading.attempt_id !== failure.attempt_id
      ))
      || boundEvidence.some((evidenceEntry) => (
        !evidenceEntry
        || evidenceEntry.run_id !== failure.run_id
        || evidenceEntry.case_id !== failure.case_id
        || evidenceEntry.attempt_id !== failure.attempt_id
      ))
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        failure.id,
        'failure'
      ));
    }
  }
  for (const repair of repairLinks) {
    const failure = failuresById.get(repair.failure_id);
    const attempt = failure
      ? attemptsById.get(failure.attempt_id)
      : null;
    const before = repair.before_identity;
    const after = repair.after_identity;
    const retest = attempts.find((entry) => (
      entry.kind === 'retest'
      && entry.parent_attempt_id === attempt?.id
      && entry.status === 'passed'
    ));
    const regression = attempts.find((entry) => (
      entry.kind === 'regression'
      && entry.parent_attempt_id === retest?.id
      && entry.status === 'passed'
    ));
    const reviewEvidence = Array.isArray(repair.review_evidence_ids)
      ? repair.review_evidence_ids.map((id) => evidenceById.get(id))
      : [];
    const postFixAttemptIds = new Set([
      retest?.id,
      regression?.id
    ].filter(Boolean));
    const reviewEvidenceValid = reviewEvidence.length >= 2
      && reviewEvidence.every((entry) => {
        if (
          !entry
          || entry.case_id !== failure?.case_id
          || !postFixAttemptIds.has(entry.attempt_id)
          || entry.result !== 'pass'
        ) return false;
        const boundReadings = readings.filter((reading) => (
          reading.evidence_ids.includes(entry.id)
        ));
        return boundReadings.length > 0
          && boundReadings.every((reading) => (
            reading.case_id === failure.case_id
            && postFixAttemptIds.has(reading.attempt_id)
            && reading.verdict === 'pass'
          ));
      });
    if (
      !failure
      || failure.change_id !== repair.change_id
      || !attempt
      || !isRecord(before)
      || before.case_snapshot_hash !== attempt.case_snapshot_hash
      || before.code_sha !== attempt.code_sha
      || before.test_sha !== attempt.test_sha
      || before.environment_hash !== attempt.environment_hash
      || before.runtime_version !== attempt.runtime_version
      || before.kernel_version !== attempt.kernel_version
      || (
        repair.status === 'completed'
        && (
          !retest
          || !regression
          || !isRecord(after)
          || after.case_snapshot_hash !== retest.case_snapshot_hash
          || after.code_sha !== retest.code_sha
          || after.test_sha !== retest.test_sha
          || after.environment_hash !== retest.environment_hash
          || after.runtime_version !== retest.runtime_version
          || after.kernel_version !== retest.kernel_version
          || !reviewEvidenceValid
        )
      )
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        repair.id,
        'repair'
      ));
    }
  }
  if (aggregate) {
    if (
      canonicalJson(stableIds(aggregate.source_case_ids))
        !== canonicalJson(stableIds([...cases.keys()]))
      || canonicalJson(stableIds(aggregate.source_reading_ids))
        !== canonicalJson(stableIds(aggregationReadings.map((entry) => (
          entry.id
        ))))
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        aggregate.id,
        'aggregate-sources'
      ));
    }
  }
  if (isRecord(freshness)) {
    const freshnessCaseIds = Array.isArray(freshness.cases)
      ? freshness.cases.map((entry) => entry?.case_id)
      : [];
    if (
      canonicalJson(stableIds(freshnessCaseIds))
      !== canonicalJson(stableIds([...cases.keys()]))
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        'freshness',
        'case_ids'
      ));
    }
    for (const fact of Array.isArray(freshness.cases)
      ? freshness.cases
      : []) {
      if (
        !cases.has(fact.case_id)
        || (
          fact.attempt_id !== null
          && !attemptsById.has(fact.attempt_id)
        )
      ) {
        blockers.push(blocker(
          'verification-report:source-binding-mismatch',
          fact.case_id || 'freshness',
          'freshness'
        ));
      }
    }
  }
  if (gateDecision && aggregate) {
    if (
      canonicalJson(stableIds(gateDecision.source_case_ids))
        !== canonicalJson(stableIds(aggregate.source_case_ids))
      || canonicalJson(stableIds(gateDecision.source_reading_ids))
        !== canonicalJson(stableIds(aggregate.source_reading_ids))
    ) {
      blockers.push(blocker(
        'verification-report:source-binding-mismatch',
        gateDecision.id,
        'gate-sources'
      ));
    }
  }
  return blockers;
}

function absolutePath(value) {
  return typeof value === 'string'
    && (path.isAbsolute(value) || path.win32.isAbsolute(value));
}

function safeCommandProjection(testCase, secretRedactor, warnings, blockers) {
  const raw = commandProjection(testCase);
  const sensitiveFlag = /^--[a-z0-9_.-]*(?:api[-_]?key|token|secret|password|passwd|credential|private[-_]?key|signing[-_]?key)$/i;
  for (let index = 0; index < raw.args.length - 1; index += 1) {
    if (sensitiveFlag.test(raw.args[index])) {
      raw.args[index + 1] = secretRedactor.marker;
      index += 1;
    }
  }
  let result;
  try {
    result = secretRedactor.redactValue(raw, {
      field: `case.${testCase.id}.runner`
    });
  } catch {
    result = null;
  }
  if (!isRecord(result) || result.ok !== true || !isRecord(result.value)) {
    blockers.push(blocker(
      'verification-report:command-redaction-failed',
      testCase.id
    ));
    return {
      runner: raw.runner,
      entrypoint: secretRedactor.marker,
      args: [],
      cwd: secretRedactor.marker,
      env_keys: []
    };
  }
  const command = result.value;
  let redacted = result.redaction_count > 0;
  if (absolutePath(command.entrypoint)) {
    command.entrypoint = secretRedactor.marker;
    redacted = true;
  }
  if (absolutePath(command.cwd)) {
    command.cwd = secretRedactor.marker;
    redacted = true;
  }
  if (redacted) {
    warnings.push(blocker(
      'verification-report:command-metadata-redacted',
      testCase.id
    ));
  }
  return command;
}

function projectCatalogCase(testCase, command) {
  return {
    ...testCase,
    runner: {
      ...testCase.runner,
      entrypoint: command.entrypoint,
      args: command.args,
      cwd: command.cwd,
      env_keys: command.env_keys
    }
  };
}

function freshnessProjection(freshness, generatedAt) {
  const fallback = {
    status: 'unknown',
    checked_at: generatedAt,
    reasons: ['freshness:missing']
  };
  if (!isRecord(freshness) || !isRecord(freshness.summary)) {
    return {
      valid: false,
      present: isRecord(freshness),
      projection: fallback
    };
  }
  const cases = Array.isArray(freshness.cases) ? freshness.cases : null;
  const sourceBlockers = Array.isArray(freshness.blockers)
    ? freshness.blockers
    : null;
  const summary = freshness.summary;
  const statuses = new Set(['fresh', 'stale', 'unknown']);
  const caseIds = new Set();
  const casesValid = cases !== null && cases.every((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.case_id !== 'string'
      || entry.case_id.length === 0
      || caseIds.has(entry.case_id)
      || (
        entry.attempt_id !== null
        && (
          typeof entry.attempt_id !== 'string'
          || entry.attempt_id.length === 0
        )
      )
      || !validTimestamp(entry.checked_at)
      || !statuses.has(entry.status)
      || !Array.isArray(entry.reasons)
      || entry.reasons.some((reason) => (
        typeof reason !== 'string' || reason.length === 0
      ))
      || new Set(entry.reasons).size !== entry.reasons.length
    ) return false;
    caseIds.add(entry.case_id);
    return true;
  });
  const actual = casesValid
    ? {
        total: cases.length,
        fresh: cases.filter((entry) => entry.status === 'fresh').length,
        stale: cases.filter((entry) => entry.status === 'stale').length,
        unknown: cases.filter((entry) => entry.status === 'unknown').length
      }
    : null;
  const derivedStatus = actual
    ? actual.unknown > 0
      ? 'unknown'
      : actual.stale > 0
        ? 'stale'
        : 'fresh'
    : 'unknown';
  const counts = [
    summary.total,
    summary.fresh,
    summary.stale,
    summary.unknown
  ];
  const valid = typeof freshness.ok === 'boolean'
    && validTimestamp(freshness.checked_at)
    && statuses.has(summary.status)
    && counts.every((value) => Number.isInteger(value) && value >= 0)
    && casesValid
    && sourceBlockers !== null
    && sourceBlockers.every((entry) => (
      isRecord(entry)
      && typeof entry.id === 'string'
      && entry.id.length > 0
    ))
    && summary.total === actual.total
    && summary.fresh === actual.fresh
    && summary.stale === actual.stale
    && summary.unknown === actual.unknown
    && summary.status === derivedStatus
    && freshness.ok === (
      derivedStatus === 'fresh' && sourceBlockers.length === 0
    );
  if (!valid) {
    return {
      valid: false,
      present: true,
      projection: {
        ...fallback,
        reasons: ['freshness:invalid']
      }
    };
  }
  return {
    valid: true,
    present: true,
    projection: {
      status: summary.status,
      checked_at: freshness.checked_at,
      reasons: stableIds(cases.flatMap((entry) => entry.reasons))
    }
  };
}

function integrityStatus(integrity) {
  const summary = integrity?.facts?.summary;
  const facts = Array.isArray(integrity?.facts?.evidence)
    ? integrity.facts.evidence
    : [];
  const brokenFact = facts.some((fact) => (
    !isRecord(fact)
    || fact.integrity !== 'intact'
    || fact.freshness !== 'fresh'
    || fact.exists !== true
    || fact.hash_match !== true
    || fact.size_match !== true
    || fact.producer_recognized !== true
    || fact.store_record_match !== true
    || fact.binding_match !== true
    || fact.path_safe !== true
  ));
  if (
    integrity?.ok === true
    && summary?.integrity === 'intact'
    && summary?.freshness === 'fresh'
    && Array.isArray(integrity.blockers)
    && integrity.blockers.length === 0
    && !brokenFact
  ) return 'intact';
  if (
    summary?.integrity === 'broken'
    || brokenFact
    || (Array.isArray(integrity?.blockers) && integrity.blockers.length > 0)
  ) return 'broken';
  return 'unknown';
}

function caseStatus(caseId, aggregate, freshness, attempts) {
  const fact = (freshness?.cases || []).find((entry) => (
    entry.case_id === caseId
  ));
  if (fact?.status === 'stale') return 'stale';
  const aggregateCase = aggregate?.case_results?.find((entry) => (
    entry.case_id === caseId
  ));
  if (aggregateCase?.status) return aggregateCase.status;
  const latest = attempts.filter((entry) => entry.case_id === caseId)
    .sort(byAttempt)
    .at(-1);
  if (latest?.status === 'running' || latest?.status === 'queued') {
    return 'running';
  }
  if (latest?.status === 'canceled') return 'canceled';
  if (latest?.status === 'failed') return 'fail';
  if (latest?.status === 'blocked') return 'blocked';
  if (latest?.status === 'passed') return 'pass';
  return 'blocked';
}

function deriveVerdict(input) {
  const {
    structuralBlockers,
    aggregate,
    freshness,
    integrity,
    runs
  } = input;
  const latestRun = [...runs].sort(byRun).at(-1);
  if (structuralBlockers.length > 0) return 'blocked';
  if (latestRun?.status === 'running' || latestRun?.status === 'planned') {
    return 'running';
  }
  if (latestRun?.status === 'canceled') return 'canceled';
  if (freshness === 'stale') return 'stale';
  if (aggregate?.status === 'fail') return 'red';
  if (aggregate?.status === 'flaky') return 'flaky';
  if (aggregate?.status === 'pass_after_fix') return 'pass_after_fix';
  if (
    structuralBlockers.length === 0
    && aggregate?.status === 'pass'
    && integrity === 'intact'
    && freshness === 'fresh'
    && input.gateDecision?.decision === 'pass'
  ) return 'green';
  return 'blocked';
}

function lifecycleStatus(verdict, gateDecision, runs) {
  if (
    gateDecision?.decision === 'pass'
    && gateDecision.stage === 'archive'
  ) return 'archived';
  if (
    gateDecision?.decision === 'pass'
    && gateDecision.stage === 'release'
    && verdict === 'green'
  ) return 'released';
  if (verdict === 'running') return 'running';
  if (verdict === 'blocked') return runs.length === 0 ? 'planned' : 'blocked';
  return 'terminal';
}

function repairLoopSummary(failures, repairLinks, attempts) {
  const failureIds = stableIds(failures.map((entry) => entry.id));
  const repairIds = stableIds(repairLinks.map((entry) => entry.id));
  const openFailures = failures.filter((entry) => (
    FAILURE_OPEN.has(entry.status)
  ));
  const openRepairs = repairLinks.filter((entry) => (
    REPAIR_OPEN.has(entry.status)
  ));
  let status = 'not_started';
  if (failures.some((entry) => entry.status === 'break_loop')) {
    status = 'break_loop';
  } else if (openRepairs.length > 0) {
    status = 'repairing';
  } else if (attempts.some((entry) => (
    entry.kind === 'regression' && entry.status === 'running'
  ))) {
    status = 'regressing';
  } else if (attempts.some((entry) => (
    entry.kind === 'retest' && entry.status === 'running'
  ))) {
    status = 'retesting';
  } else if (openFailures.length > 0) {
    status = openFailures.some((entry) => (
      entry.status === 'blocked_for_decision'
    )) ? 'blocked' : 'open';
  } else if (failures.length > 0) {
    status = 'closed';
  }
  return {
    status,
    failure_ids: failureIds,
    repair_ids: repairIds,
    history_event_count: failures.length + repairLinks.length + attempts.filter(
      (entry) => entry.kind !== 'initial'
    ).length
  };
}

function createReportModelBuilder(options = {}) {
  const {
    schemaRegistry,
    aggregator,
    decisionEngine,
    evidenceIndexAuthority,
    gateContextAuthority,
    factAuthority,
    secretRedactor,
    clock = () => new Date().toISOString()
  } = options;
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !aggregator
    || typeof aggregator.aggregate !== 'function'
    || !decisionEngine
    || typeof decisionEngine.decide !== 'function'
    || !isEvidenceIndexAuthority(evidenceIndexAuthority)
    || !gateContextAuthority
    || typeof gateContextAuthority.resolve !== 'function'
    || !isReportFactAuthority(factAuthority)
    || !isSecretRedactor(secretRedactor)
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-report:config-invalid');
  }
  const crossReferenceValidator = createCrossReferenceValidator({
    schemaRegistry
  });

  function build(request) {
    let input;
    try {
      input = structuredClone(request);
    } catch {
      input = {};
    }
    const generatedAt = clock();
    if (!validTimestamp(generatedAt)) {
      throw new Error('verification-report:clock-invalid');
    }
    const changeId = typeof input?.change_id === 'string'
      ? input.change_id
      : 'change-unknown';
    const blockers = [];
    const warnings = [];
    for (const warning of Array.isArray(input.historical_warnings)
      ? input.historical_warnings
      : []) {
      if (
        warning
        && typeof warning.id === 'string'
        && (
          warning.artifact === null
          || typeof warning.artifact === 'string'
        )
      ) {
        warnings.push(warning);
      }
    }

    const caseSnapshot = validateOne(
      schemaRegistry,
      'case-snapshot',
      input.case_snapshot,
      blockers
    );
    if (!caseSnapshot) {
      blockers.push(blocker(
        'verification-report:case-snapshot-missing',
        changeId
      ));
    } else if (computeSnapshotHash(caseSnapshot) !== caseSnapshot.snapshot_hash) {
      blockers.push(blocker(
        'verification-report:snapshot-hash-mismatch',
        caseSnapshot.id,
        caseSnapshot.snapshot_hash
      ));
    }
    const runs = validateMany(
      schemaRegistry,
      'verification-run',
      input.runs,
      blockers
    );
    const attempts = validateMany(
      schemaRegistry,
      'attempt',
      input.attempts,
      blockers
    );
    const readings = validateMany(
      schemaRegistry,
      'reading',
      input.readings,
      blockers
    );
    const failures = validateMany(
      schemaRegistry,
      'failure-packet',
      input.failures,
      blockers
    );
    const repairLinks = validateMany(
      schemaRegistry,
      'repair-link',
      input.repair_links,
      blockers
    );
    const evidenceIndex = validateOne(
      schemaRegistry,
      'evidence-index',
      input.evidence_index,
      blockers
    );
    const evidence = evidenceIndex?.entries || [];
    if (!evidenceIndex) {
      blockers.push(blocker(
        'verification-report:evidence-index-missing',
        changeId
      ));
    } else if (evidenceIndex.record_count !== evidence.length) {
      blockers.push(blocker(
        'verification-report:evidence-index-count-mismatch',
        changeId
      ));
    }
    for (const evidenceId of duplicateEvidenceIds(evidence)) {
      blockers.push(blocker(
        'verification-report:duplicate-id',
        evidenceId,
        'evidence'
      ));
    }
    verifyEvidenceIndex(
      evidenceIndexAuthority,
      evidenceIndex,
      changeId,
      blockers
    );
    const candidateAggregate = validateAggregate(
      input.aggregate,
      changeId,
      blockers
    );
    const candidateGateDecision = validateOne(
      schemaRegistry,
      'gate-decision',
      input.gate_decision,
      blockers
    );
    const running = runs.some((entry) => (
      ['planned', 'running'].includes(entry.status)
    ));
    const freshnessValidation = freshnessProjection(
      input.freshness,
      generatedAt
    );
    const projectedFreshness = freshnessValidation.projection;
    const projectedIntegrity = integrityStatus(input.integrity);
    const aggregationReadings = currentReadings(
      caseSnapshot,
      attempts,
      readings
    );
    const terminalStates = validateTerminalFacts({
      requestedFacts: input.policy_facts?.terminal_states,
      attempts,
      readings,
      failures,
      repairLinks,
      freshness: input.freshness
    }, blockers);
    const aggregationInput = aggregateRequest({
      changeId,
      caseSnapshot,
      readings: aggregationReadings,
      evidence,
      integrity: input.integrity,
      policyFacts: {
        not_applicable_decisions:
          input.policy_facts?.not_applicable_decisions || [],
        terminal_states: terminalStates
      }
    });
    const aggregate = running && !candidateAggregate
      ? null
      : recomputeAggregate({
          aggregator,
          candidate: candidateAggregate,
          request: aggregationInput,
          changeId,
          blockers
        });
    if (!candidateAggregate && !running) {
      blockers.push(blocker(
        'verification-report:aggregate-missing',
        changeId
      ));
    }
    if (!candidateGateDecision && !running) {
      blockers.push(blocker(
        'verification-report:gate-decision-missing',
        changeId
      ));
    }
    verifyFactAuthority({
      authority: factAuthority,
      method: 'verifyIntegrity',
      payload: {
        change_id: changeId,
        evidence_index_version: evidenceIndex?.index_version || null,
        evidence_index_digest: evidenceIndex?.source_digest || null,
        integrity: input.integrity
      },
      expected: {
        change_id: changeId,
        evidence_index_version: evidenceIndex?.index_version || null,
        evidence_index_digest: evidenceIndex?.source_digest || null,
        integrity_digest: digestValue(input.integrity)
      },
      blockerId: 'verification-report:integrity-unverified',
      artifact: changeId,
      blockers
    });
    const gateFacts = {
      failure_state_status: input.failure_state_status,
      failure_state_digest: input.failure_state_digest,
      authority_chain_digest: input.authority_chain_digest
    };
    verifyFactAuthority({
      authority: factAuthority,
      method: 'verifyGateFacts',
      payload: {
        change_id: changeId,
        ...gateFacts
      },
      expected: {
        change_id: changeId,
        ...gateFacts
      },
      blockerId: 'verification-report:gate-facts-unverified',
      artifact: changeId,
      blockers
    });
    verifyFactAuthority({
      authority: factAuthority,
      method: 'verifyFreshness',
      payload: {
        change_id: changeId,
        case_snapshot_hash: caseSnapshot?.snapshot_hash || null,
        run_ids: stableIds(runs.map((entry) => entry.id)),
        attempt_ids: stableIds(attempts.map((entry) => entry.id)),
        freshness: input.freshness
      },
      expected: {
        change_id: changeId,
        case_snapshot_hash: caseSnapshot?.snapshot_hash || null,
        run_ids: stableIds(runs.map((entry) => entry.id)),
        attempt_ids: stableIds(attempts.map((entry) => entry.id)),
        freshness_digest: digestValue(input.freshness)
      },
      blockerId: 'verification-report:freshness-unverified',
      artifact: changeId,
      blockers
    });
    const gateContext = running && !candidateGateDecision
      ? null
      : resolveGateContext(gateContextAuthority, changeId, blockers);
    const gateDecision = running && !candidateGateDecision
      ? null
      : recomputeGate({
          schemaRegistry,
          decisionEngine,
          candidate: candidateGateDecision,
          aggregationRequest: aggregationInput,
          evidenceIndex,
          freshness: projectedFreshness,
          integrity: projectedIntegrity,
          failures,
          runs,
          changeId,
          gateContext,
          gateFacts,
          blockers
        });
    blockers.push(...sourceBindings({
      changeId,
      caseSnapshot,
      evidenceIndex,
      runs,
      attempts,
      readings,
      aggregationReadings,
      evidence,
      failures,
      repairLinks,
      aggregate,
      freshness: input.freshness,
      gateDecision
    }));
    blockers.push(...crossReferenceBlockers(crossReferenceValidator, {
      changeId,
      caseSnapshot,
      runs,
      attempts,
      readings,
      evidence
    }));

    const resolved = resolveEvidenceLinks(evidence, input.integrity);
    blockers.push(...resolved.blockers);
    const integrity = projectedIntegrity;
    if (integrity !== 'intact') {
      blockers.push(blocker(
        'verification-report:integrity-not-intact',
        evidenceIndex?.source_raw || changeId,
        integrity
      ));
    }
    const freshness = projectedFreshness;
    if (!freshnessValidation.valid && freshnessValidation.present) {
      blockers.push(blocker(
        'verification-report:freshness-invalid',
        changeId
      ));
    }
    if (freshness.status === 'unknown' && !running) {
      blockers.push(blocker(
        'verification-report:freshness-unknown',
        changeId
      ));
    }

    const sourceCases = [...(caseSnapshot?.cases || [])].sort(byId);
    const commandByCase = new Map(sourceCases.map((testCase) => [
      testCase.id,
      safeCommandProjection(
        testCase,
        secretRedactor,
        warnings,
        blockers
      )
    ]));
    const structuralBlockers = stableBlockers(blockers);
    const verdict = deriveVerdict({
      structuralBlockers,
      aggregate,
      freshness: freshness.status,
      integrity,
      runs,
      gateDecision
    });
    const domains = Object.fromEntries(SIX_DOMAINS.map((domain) => [
      domain,
      aggregate?.domain_results?.find((entry) => (
        entry.domain === domain
      ))?.status || (running ? 'running' : 'blocked')
    ]));
    const evidenceByCase = new Map();
    for (const entry of resolved.evidence) {
      const list = evidenceByCase.get(entry.case_id) || [];
      list.push(entry);
      evidenceByCase.set(entry.case_id, list);
    }
    const catalog = sourceCases.map((testCase) => (
      projectCatalogCase(testCase, commandByCase.get(testCase.id))
    ));
    const results = sourceCases.map((testCase) => {
      const caseId = testCase.id;
      const caseRuns = runs.filter((entry) => entry.case_ids.includes(caseId));
      const caseAttempts = attempts.filter((entry) => (
        entry.case_id === caseId
      ));
      const caseReadings = readings.filter((entry) => (
        entry.case_id === caseId
      ));
      const caseFailures = failures.filter((entry) => (
        entry.case_id === caseId
      ));
      const failureIds = new Set(caseFailures.map((entry) => entry.id));
      const caseRepairs = repairLinks.filter((entry) => (
        failureIds.has(entry.failure_id)
      ));
      const caseBlockers = structuralBlockers.filter((entry) => (
        entry.artifact === caseId
        || caseAttempts.some((attempt) => attempt.id === entry.artifact)
        || caseReadings.some((reading) => reading.id === entry.artifact)
        || (evidenceByCase.get(caseId) || []).some((evidenceEntry) => (
          evidenceEntry.id === entry.artifact
        ))
      ));
      return {
        case_id: caseId,
        status: caseStatus(
          caseId,
          aggregate,
          input.freshness,
          caseAttempts
        ),
        freshness: (
          freshnessValidation.valid ? input.freshness.cases : []
        ).find((entry) => (
          entry.case_id === caseId
        ))?.status || 'unknown',
        command: commandByCase.get(caseId),
        runs: caseRuns.sort(byRun),
        attempts: caseAttempts.sort(byAttempt),
        readings: caseReadings.sort(byId),
        evidence: (evidenceByCase.get(caseId) || []).sort(byId),
        failures: caseFailures.sort(byId),
        repairs: caseRepairs.sort(byId),
        blockers: stableBlockers(caseBlockers)
      };
    });
    const openFailureIds = stableIds(failures.filter((entry) => (
      FAILURE_OPEN.has(entry.status)
    )).map((entry) => entry.id));
    const openRepairIds = stableIds(repairLinks.filter((entry) => (
      REPAIR_OPEN.has(entry.status)
    )).map((entry) => entry.id));
    const latestRun = [...runs].sort(byRun).at(-1) || null;
    const semantic = {
      change_id: changeId,
      verdict,
      sources: {
        generation_id: typeof input.generation_id === 'string'
          ? input.generation_id
          : latestRun?.generation_id || null,
        case_snapshot_id: caseSnapshot?.id || null,
        case_snapshot_hash: caseSnapshot?.snapshot_hash || null,
        run_ids: stableIds(runs.map((entry) => entry.id)),
        attempt_ids: stableIds(attempts.map((entry) => entry.id)),
        reading_ids: stableIds(readings.map((entry) => entry.id)),
        evidence_ids: stableIds(evidence.map((entry) => entry.id)),
        evidence_index_version: evidenceIndex?.index_version || null,
        evidence_index_digest: evidenceIndex?.source_digest || null,
        aggregate_id: aggregate?.id || null,
        gate_decision_id: gateDecision?.id || null
      },
      summary: {
        lifecycle_status: lifecycleStatus(verdict, gateDecision, runs),
        domains,
        totals: {
          cases: catalog.length,
          runs: runs.length,
          attempts: attempts.length,
          readings: readings.length,
          evidence: evidence.length,
          failures: failures.length,
          repairs: repairLinks.length
        },
        integrity,
        freshness,
        repair_loop: repairLoopSummary(failures, repairLinks, attempts),
        open_failure_ids: openFailureIds,
        open_repair_ids: openRepairIds,
        runtime_version: latestRun?.runtime_version
          || gateDecision?.runtime_version
          || null,
        kernel_version: latestRun?.kernel_version
          || gateDecision?.kernel_version
          || null
      },
      catalog,
      results,
      blockers: structuralBlockers,
      warnings: stableBlockers(warnings)
    };
    const model = {
      schema: 'specnav.verification.report-model.v1',
      id: `report-model-${sha256(canonicalJson(semantic))}`,
      ...semantic,
      model_version: 2,
      generated_at: generatedAt
    };
    const validation = schemaRegistry.validate('report-model', model);
    if (!validation.ok) {
      return deepFreeze({
        ok: false,
        status: 'blocked',
        model: null,
        blockers: stableBlockers([
          ...structuralBlockers,
          blocker(
            'verification-report:model-schema-invalid',
            model.id,
            validation.blockers
          )
        ])
      });
    }
    return deepFreeze({
      ok: verdict !== 'blocked' && structuralBlockers.length === 0,
      status: verdict,
      model: validation.value,
      blockers: structuralBlockers
    });
  }

  return Object.freeze({ build });
}

module.exports = {
  createReportModelBuilder
};
