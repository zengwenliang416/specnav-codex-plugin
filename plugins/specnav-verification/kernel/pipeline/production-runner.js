'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const PROTOCOL_ENV = Object.freeze([
  'SPECNAV_VERIFICATION_ASSERTION_IDS',
  'SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE'
]);

const REGISTERED_PRODUCERS = Object.freeze([
  'command-runner',
  'midscene-runner',
  'playwright-runner',
  'specnav-playwright-worker'
]);

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function stableHash(value) {
  return sha256(canonicalJson(value));
}

function executionFingerprint(context) {
  return {
    case_snapshot_hash: context.snapshot.snapshot_hash,
    code_sha: context.codeSha,
    test_sha: context.testSha,
    environment_hash: context.environmentHash,
    runtime_version: context.runtimeStatus.runtime_version,
    kernel_version: context.kernelVersion
  };
}

function sameFingerprint(left, right) {
  return [
    'case_snapshot_hash',
    'code_sha',
    'test_sha',
    'environment_hash',
    'runtime_version',
    'kernel_version'
  ].every((field) => left?.[field] === right?.[field]);
}

function compactTimestamp(value) {
  return value.replace(/[-:.TZ]/g, '').slice(0, 14);
}

function readJson(file, id) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(file, 'utf8')),
      blockers: []
    };
  } catch (error) {
    return {
      ok: false,
      blockers: [blocker(
        id,
        file,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
}

function readJsonl(file) {
  try {
    if (!fs.existsSync(file)) return { ok: true, values: [], blockers: [] };
    const values = fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
    return { ok: true, values, blockers: [] };
  } catch (error) {
    return {
      ok: false,
      values: [],
      blockers: [blocker(
        'verification-production:assertion-protocol-invalid',
        file,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
}

function currentProjection(file, fallback = []) {
  if (!fs.existsSync(file)) return structuredClone(fallback);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function exactProtocol(testCase, values) {
  const byId = new Map();
  const blockers = [];
  for (const value of values) {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || typeof value.assertion_id !== 'string'
    ) {
      blockers.push(blocker(
        'verification-production:assertion-result-invalid',
        testCase.id
      ));
      continue;
    }
    const entries = byId.get(value.assertion_id) || [];
    entries.push(value);
    byId.set(value.assertion_id, entries);
  }
  const results = [];
  for (const assertion of testCase.assertions) {
    const matches = byId.get(assertion.id) || [];
    if (matches.length !== 1) {
      blockers.push(blocker(
        matches.length === 0
          ? 'verification-production:assertion-result-missing'
          : 'verification-production:assertion-result-ambiguous',
        assertion.id
      ));
      continue;
    }
    const result = matches[0];
    if (
      result.method !== 'equal'
      || canonicalJson(result.expected) !== canonicalJson(assertion.expected)
      || !['passed', 'failed'].includes(result.status)
      || (canonicalJson(result.actual) === canonicalJson(result.expected))
        !== (result.status === 'passed')
    ) {
      blockers.push(blocker(
        'verification-production:assertion-result-invalid',
        assertion.id
      ));
      continue;
    }
    results.push({
      id: assertion.id,
      method: result.method,
      expected: structuredClone(result.expected),
      actual: structuredClone(result.actual),
      status: result.status
    });
  }
  for (const assertionId of byId.keys()) {
    if (!testCase.assertions.some((entry) => entry.id === assertionId)) {
      blockers.push(blocker(
        'verification-production:assertion-result-unapproved',
        assertionId
      ));
    }
  }
  return { ok: blockers.length === 0, results, blockers };
}

function stepForAssertion(testCase, assertionId) {
  const matches = testCase.steps.filter((step) => (
    step.assertion_ids.includes(assertionId)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function redactedText(redactor, value, field) {
  const result = redactor.redactText(value, { field });
  return result.ok
    ? result
    : {
        ok: false,
        value: '',
        redaction: {
          status: 'redacted',
          redacted_fields: [field]
        },
        blockers: result.blockers
      };
}

function redactedJson(redactor, value, field) {
  const result = redactor.redactValue(value, { field });
  return result.ok
    ? result
    : {
        ok: false,
        value: null,
        redaction: {
          status: 'redacted',
          redacted_fields: [field]
        },
        blockers: result.blockers
      };
}

function screenshotCandidate(artifactRoot, attemptId) {
  const root = path.join(artifactRoot, attemptId);
  const manifestFile = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const screenshot = manifest.artifacts?.find((entry) => (
      entry?.kind === 'screenshot' && typeof entry.file === 'string'
    ));
    if (!screenshot) return null;
    const file = path.resolve(root, screenshot.file);
    const relative = path.relative(root, file);
    if (
      relative.startsWith('..')
      || path.isAbsolute(relative)
      || !fs.existsSync(file)
      || fs.lstatSync(file).isSymbolicLink()
      || !fs.lstatSync(file).isFile()
    ) {
      return null;
    }
    const bytes = fs.readFileSync(file);
    if (
      screenshot.sha256 !== crypto.createHash('sha256').update(bytes).digest('hex')
      || screenshot.size !== bytes.length
    ) {
      return null;
    }
    return file;
  } catch {
    return null;
  }
}

function evidenceRequests(context) {
  const {
    testCase,
    execution,
    protocol,
    redactor,
    artifactRoot
  } = context;
  const requests = [];
  const blockers = [];
  const commandText = [
    `status=${execution.status}`,
    `exit_status=${execution.command?.exit_status ?? 'null'}`,
    '--- stdout ---',
    execution.logs?.stdout || '',
    '--- stderr ---',
    execution.logs?.stderr || ''
  ].join('\n');
  const commandOutput = redactedText(
    redactor,
    commandText,
    'execution.command_output'
  );
  blockers.push(...commandOutput.blockers);
  const screenshot = screenshotCandidate(artifactRoot, execution.attempt.id);

  for (const assertion of testCase.assertions) {
    const step = stepForAssertion(testCase, assertion.id);
    const result = protocol.results.find((entry) => entry.id === assertion.id);
    for (const kind of assertion.evidence_kinds) {
      let content;
      let sourcePath;
      let contentType = 'application/json';
      let redaction = {
        status: 'not_required',
        redacted_fields: []
      };
      if (kind === 'command_output' || kind === 'log') {
        content = commandOutput.value;
        contentType = 'text/plain';
        redaction = commandOutput.redaction;
      } else if (kind === 'assertion_result' || kind === 'structured_comparison') {
        if (!result) continue;
        const projection = redactedJson(
          redactor,
          {
            assertion_id: assertion.id,
            method: result.method,
            expected: result.expected,
            actual: result.actual,
            status: result.status
          },
          `execution.assertions.${assertion.id}`
        );
        blockers.push(...projection.blockers);
        if (!projection.ok) continue;
        content = `${JSON.stringify(projection.value, null, 2)}\n`;
        redaction = projection.redaction;
      } else if (kind === 'screenshot') {
        if (!screenshot) {
          blockers.push(blocker(
            'verification-production:screenshot-missing',
            assertion.id
          ));
          continue;
        }
        sourcePath = screenshot;
        contentType = 'image/png';
      } else {
        blockers.push(blocker(
          'verification-production:evidence-kind-unsupported',
          assertion.id,
          kind
        ));
        continue;
      }
      requests.push({
        evidence: {
          kind,
          producer: 'command-runner',
          captured_at: context.capturedAt,
          change_id: execution.run.change_id,
          run_id: execution.run.id,
          case_id: testCase.id,
          attempt_id: execution.attempt.id,
          step_id: step.id,
          assertion_id: assertion.id,
          code_sha: execution.run.code_sha,
          test_sha: execution.run.test_sha,
          environment_hash: execution.run.environment_hash,
          runtime_version: execution.run.runtime_version,
          kernel_version: execution.run.kernel_version,
          redaction,
          content_type: contentType,
          result: result
            ? result.status === 'passed' ? 'pass' : 'fail'
            : execution.status === 'passed' ? 'info' : 'fail'
        },
        ...(sourcePath ? { source_path: sourcePath } : { content })
      });
    }
  }
  return { requests, blockers };
}

function artifactContentType(kind) {
  return {
    assertion_result: 'application/json',
    log: 'application/json',
    screenshot: 'image/png',
    trace: 'application/zip',
    video: 'video/webm'
  }[kind] || 'application/octet-stream';
}

function browserEvidenceRequests(context) {
  const {
    testCase,
    execution,
    redactor,
    capturedAt
  } = context;
  const requests = [];
  const blockers = [];
  const producer = testCase.runner.kind === 'midscene'
    ? 'midscene-runner'
    : 'playwright-runner';
  const artifacts = Array.isArray(execution.artifacts)
    ? execution.artifacts
    : [];
  const assertions = Array.isArray(execution.assertions)
    ? execution.assertions
    : [];

  for (const assertion of testCase.assertions) {
    const step = stepForAssertion(testCase, assertion.id);
    const assertionResult = assertions.find((entry) => (
      entry?.id === assertion.id || entry?.assertion_id === assertion.id
    ));
    for (const kind of assertion.evidence_kinds) {
      const matching = artifacts.filter((entry) => entry?.kind === kind);
      if (matching.length > 0) {
        for (const artifact of matching) {
          requests.push({
            evidence: {
              kind,
              producer,
              captured_at: capturedAt,
              change_id: execution.run.change_id,
              run_id: execution.run.id,
              case_id: testCase.id,
              attempt_id: execution.attempt.id,
              step_id: step.id,
              assertion_id: assertion.id,
              code_sha: execution.run.code_sha,
              test_sha: execution.run.test_sha,
              environment_hash: execution.run.environment_hash,
              runtime_version: execution.run.runtime_version,
              kernel_version: execution.run.kernel_version,
              redaction: {
                status: 'not_required',
                redacted_fields: []
              },
              content_type: artifactContentType(kind),
              result: assertionResult?.status === 'passed'
                ? 'pass'
                : assertionResult?.status === 'failed'
                  ? 'fail'
                  : 'info'
            },
            source_path: artifact.path
          });
        }
        continue;
      }
      if (
        ['assertion_result', 'structured_comparison'].includes(kind)
        && assertionResult
      ) {
        const projection = redactedJson(
          redactor,
          {
            assertion_id: assertion.id,
            method: assertionResult.method,
            expected: assertionResult.expected,
            actual: assertionResult.actual,
            status: assertionResult.status
          },
          `execution.assertions.${assertion.id}`
        );
        blockers.push(...projection.blockers);
        if (!projection.ok) continue;
        requests.push({
          evidence: {
            kind,
            producer,
            captured_at: capturedAt,
            change_id: execution.run.change_id,
            run_id: execution.run.id,
            case_id: testCase.id,
            attempt_id: execution.attempt.id,
            step_id: step.id,
            assertion_id: assertion.id,
            code_sha: execution.run.code_sha,
            test_sha: execution.run.test_sha,
            environment_hash: execution.run.environment_hash,
            runtime_version: execution.run.runtime_version,
            kernel_version: execution.run.kernel_version,
            redaction: projection.redaction,
            content_type: 'application/json',
            result: assertionResult.status === 'passed' ? 'pass' : 'fail'
          },
          content: `${JSON.stringify(projection.value, null, 2)}\n`
        });
        continue;
      }
      blockers.push(blocker(
        'verification-production:evidence-kind-missing',
        assertion.id,
        kind
      ));
    }
  }
  return { requests, blockers };
}

function appendEvidence(store, requests) {
  const evidence = [];
  const blockers = [];
  for (const request of requests) {
    const result = store.append(request);
    if (!result.ok) {
      blockers.push(...result.blockers);
      continue;
    }
    evidence.push(result.evidence);
  }
  return { evidence, blockers };
}

function caseFingerprints(testCase) {
  return {
    browser_project: testCase.runner.browser_project || 'none',
    test_data_snapshot: stableHash({
      preconditions: testCase.preconditions,
      runner: testCase.runner,
      steps: testCase.steps
    }),
    scenario_hash: testCase.runner.scenario_hash || stableHash({
      runner: testCase.runner,
      steps: testCase.steps,
      assertions: testCase.assertions
    })
  };
}

function commandEnvironment(testCase, context, sourceEnvironment = process.env) {
  const values = {
    SPECNAV_VERIFICATION_ASSERTION_IDS: testCase.assertions
      .map((entry) => entry.id).join(','),
    SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE: context.protocolFile,
    SPECNAV_REPORT_ARTIFACT_ROOT: context.artifactRoot,
    SPECNAV_REPORT_ARTIFACT_RUN_ID: context.attemptId
  };
  const blockers = [];
  const env = {};
  for (const key of testCase.runner.env_keys) {
    const value = Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : sourceEnvironment[key];
    if (typeof value !== 'string' || value.length === 0) {
      blockers.push(blocker(
        'verification-production:approved-environment-missing',
        testCase.id,
        key
      ));
      continue;
    }
    env[key] = value;
  }
  return { ok: blockers.length === 0, env, blockers };
}

function approvalInput(input) {
  return {
    snapshot: input.snapshot,
    approval: input.approval,
    currentRequirements: input.requirements,
    currentAcceptance: input.acceptance,
    expectedReviewerId: input.reviewerId
  };
}

function makeInitialRun(context, testCase, now) {
  const fingerprints = caseFingerprints(testCase);
  const suffix = stableHash({
    case_id: testCase.id,
    now,
    code_sha: context.codeSha,
    test_sha: context.testSha
  }).slice(0, 16);
  return {
    run: {
      schema: 'specnav.verification.run.v1',
      id: `run-${compactTimestamp(now)}-${suffix}`,
      change_id: context.snapshot.change_id,
      case_snapshot_id: context.snapshot.id,
      case_snapshot_hash: context.snapshot.snapshot_hash,
      case_ids: [testCase.id],
      code_sha: context.codeSha,
      test_sha: context.testSha,
      environment_hash: context.environmentHash,
      runtime_version: context.runtimeStatus.runtime_version,
      kernel_version: context.kernelVersion,
      generation_id: context.generationId,
      status: 'planned',
      created_at: now,
      started_at: null,
      completed_at: null,
      kind: 'initial',
      origin_run_id: null,
      parent_run_id: null,
      parent_attempt_id: null,
      failure_id: null
    },
    attempt: {
      id: `attempt-${compactTimestamp(now)}-${suffix}`,
      kind: 'initial',
      sequence: 1,
      scenario_hash: fingerprints.scenario_hash,
      browser_project: fingerprints.browser_project,
      test_data_snapshot: fingerprints.test_data_snapshot
    },
    fingerprints
  };
}

function executionHistory(verificationRoot) {
  const v2 = path.join(verificationRoot, 'v2');
  return {
    runs: currentProjection(path.join(v2, 'runs.json')),
    attempts: currentProjection(path.join(v2, 'attempts.json')),
    failures: currentProjection(path.join(v2, 'failures.json'))
  };
}

function makeFollowupRun(context, testCase, now, options, history) {
  const kind = options.kind || 'initial';
  if (kind === 'initial') {
    return {
      ok: true,
      identity: makeInitialRun(context, testCase, now),
      previousAttempts: [],
      blockers: []
    };
  }
  if (!['retry', 'retest', 'regression'].includes(kind)) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-production:attempt-kind-invalid',
        testCase.id,
        kind
      )]
    };
  }
  const parentAttempt = history.attempts.find((entry) => (
    entry.id === options.parentAttemptId
  ));
  const parentRun = parentAttempt
    ? history.runs.find((entry) => entry.id === parentAttempt.run_id)
    : null;
  if (!parentAttempt || !parentRun) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-production:parent-execution-missing',
        options.parentAttemptId || testCase.id
      )]
    };
  }
  const fingerprints = caseFingerprints(testCase);
  const suffix = stableHash({
    case_id: testCase.id,
    attempt_kind: kind,
    parent_attempt_id: parentAttempt.id,
    now,
    code_sha: context.codeSha,
    test_sha: context.testSha
  }).slice(0, 16);
  const attempt = {
    id: `attempt-${compactTimestamp(now)}-${suffix}`,
    kind,
    sequence: parentAttempt.sequence + 1,
    parent_attempt_id: parentAttempt.id,
    scenario_hash: fingerprints.scenario_hash,
    browser_project: fingerprints.browser_project,
    test_data_snapshot: fingerprints.test_data_snapshot
  };
  if (kind === 'retry') {
    const previousAttempts = history.attempts
      .filter((entry) => entry.run_id === parentRun.id)
      .sort((left, right) => left.sequence - right.sequence);
    const latest = previousAttempts.at(-1);
    if (
      latest?.id !== parentAttempt.id
      || parentAttempt.case_id !== testCase.id
      || parentRun.code_sha !== context.codeSha
      || parentRun.test_sha !== context.testSha
      || parentRun.environment_hash !== context.environmentHash
      || parentRun.runtime_version !== context.runtimeStatus.runtime_version
      || parentRun.kernel_version !== context.kernelVersion
      || parentRun.case_snapshot_hash !== context.snapshot.snapshot_hash
      || parentRun.generation_id !== context.generationId
    ) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-production:retry-identity-mismatch',
          parentAttempt.id
        )]
      };
    }
    return {
      ok: true,
      identity: {
        run: {
          ...parentRun,
          status: 'planned',
          started_at: null,
          completed_at: null
        },
        attempt,
        fingerprints
      },
      previousAttempts,
      blockers: []
    };
  }
  if (
    typeof options.failureId !== 'string'
    || options.failureId.trim() === ''
    || (
      kind === 'retest'
      && !['initial', 'retry'].includes(parentAttempt.kind)
    )
    || (
      kind === 'regression'
      && parentAttempt.kind !== 'retest'
    )
  ) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-production:followup-lineage-invalid',
        parentAttempt.id,
        kind
      )]
    };
  }
  const failureMatches = history.failures.filter((entry) => (
    entry.id === options.failureId
  ));
  const rootFailure = failureMatches.length === 1
    ? failureMatches[0]
    : null;
  const rootRun = rootFailure
    ? history.runs.find((entry) => entry.id === rootFailure.run_id)
    : null;
  const commonLineageValid = rootFailure
    && rootFailure.change_id === context.snapshot.change_id
    && rootFailure.status === 'open'
    && rootRun
    && rootRun.kind === 'initial'
    && rootRun.change_id === context.snapshot.change_id
    && rootRun.failure_id === null
    && rootRun.origin_run_id === null
    && rootRun.parent_run_id === null
    && rootRun.case_ids.includes(rootFailure.case_id)
    && rootRun.generation_id === context.generationId
    && parentRun.change_id === context.snapshot.change_id
    && parentRun.generation_id === context.generationId
    && parentRun.case_ids.includes(parentAttempt.case_id);
  const kindLineageValid = kind === 'retest'
    ? commonLineageValid
      && rootFailure.case_id === testCase.id
      && parentAttempt.case_id === testCase.id
      && parentRun.id === rootRun.id
      && ['initial', 'retry'].includes(parentAttempt.kind)
    : commonLineageValid
      && parentRun.kind === 'retest'
      && parentRun.failure_id === rootFailure.id
      && parentRun.origin_run_id === rootRun.id
      && parentAttempt.case_id === parentRun.case_ids[0];
  if (!kindLineageValid) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-production:followup-failure-lineage-invalid',
        options.failureId,
        kind
      )]
    };
  }
  const repairIdentity = options.repairIdentity;
  if (
    !repairIdentity
    || !sameFingerprint(executionFingerprint(context), repairIdentity)
  ) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-production:followup-repair-identity-mismatch',
        options.failureId,
        kind
      )]
    };
  }
  const originRunId = rootRun.id;
  return {
    ok: true,
    identity: {
      run: {
        schema: 'specnav.verification.run.v1',
        id: `run-${compactTimestamp(now)}-${suffix}`,
        change_id: context.snapshot.change_id,
        case_snapshot_id: context.snapshot.id,
        case_snapshot_hash: context.snapshot.snapshot_hash,
        case_ids: [testCase.id],
        code_sha: context.codeSha,
        test_sha: context.testSha,
        environment_hash: context.environmentHash,
        runtime_version: context.runtimeStatus.runtime_version,
        kernel_version: context.kernelVersion,
        generation_id: context.generationId,
        status: 'planned',
        created_at: now,
        started_at: null,
        completed_at: null,
        kind,
        origin_run_id: originRunId,
        parent_run_id: parentRun.id,
        parent_attempt_id: parentAttempt.id,
        failure_id: options.failureId
      },
      attempt,
      fingerprints
    },
    previousAttempts: [],
    blockers: []
  };
}

function persistExecution(store, execution) {
  const runRoot = `runs/${execution.run.id}`;
  const attemptRoot = `${runRoot}/attempts/${execution.attempt.id}`;
  const writes = [
    store.appendJsonl(
      `${runRoot}/run-states.jsonl`,
      execution.run_states
    ),
    store.publishJson(`${runRoot}/run.json`, execution.run),
    store.appendJsonl(
      `${attemptRoot}/states.jsonl`,
      execution.attempt_states
    ),
    store.publishJson(`${attemptRoot}/attempt.json`, execution.attempt),
    store.appendJsonl(`${runRoot}/events.jsonl`, execution.events),
    store.publishImmutableJson(
      `${attemptRoot}/execution.json`,
      execution
    )
  ];
  return writes.flatMap((entry) => entry.ok ? [] : entry.blockers);
}

function mergeById(existing, additions) {
  const values = new Map();
  for (const entry of [...existing, ...additions]) {
    if (entry && typeof entry.id === 'string') values.set(entry.id, entry);
  }
  return [...values.values()].sort((left, right) => (
    left.id.localeCompare(right.id)
  ));
}

function mergeIntegrityResults(values) {
  const blockers = [];
  const factsById = new Map();
  for (const value of values) {
    blockers.push(...(Array.isArray(value?.blockers) ? value.blockers : []));
    for (const fact of value?.facts?.evidence || []) {
      if (!fact || typeof fact.evidence_id !== 'string') continue;
      const prior = factsById.get(fact.evidence_id);
      if (prior && canonicalJson(prior) !== canonicalJson(fact)) {
        blockers.push(blocker(
          'verification-production:integrity-fact-conflict',
          fact.evidence_id
        ));
        continue;
      }
      factsById.set(fact.evidence_id, fact);
    }
  }
  const evidence = [...factsById.values()].sort((left, right) => (
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
  const uniqueBlockers = new Map();
  for (const entry of blockers) {
    const key = canonicalJson(entry);
    if (!uniqueBlockers.has(key)) uniqueBlockers.set(key, entry);
  }
  const stable = [...uniqueBlockers.values()].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ));
  return {
    ok: stable.length === 0 && intact,
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
    blockers: stable
  };
}

function aggregateRunIntegrity(store, execution, currentIntegrity) {
  const values = [];
  const blockers = [];
  for (const attempt of execution.attempts) {
    if (attempt.id === execution.attempt.id) {
      values.push(currentIntegrity);
      continue;
    }
    const relative = [
      'runs',
      execution.run.id,
      'attempts',
      attempt.id,
      'integrity.json'
    ].join('/');
    const persisted = store.readJson(relative);
    if (!persisted.ok) {
      blockers.push(blocker(
        'verification-production:attempt-integrity-missing',
        attempt.id,
        persisted.blockers
      ));
      continue;
    }
    values.push(persisted.value);
  }
  const aggregate = mergeIntegrityResults(values);
  return {
    ...aggregate,
    ok: blockers.length === 0 && aggregate.ok,
    blockers: [...aggregate.blockers, ...blockers].sort((left, right) => (
      canonicalJson(left).localeCompare(canonicalJson(right))
    ))
  };
}

function resolveScenario(scenarioRegistry, testCase) {
  if (!['playwright', 'midscene'].includes(testCase.runner.kind)) {
    return { ok: true, value: null, blockers: [] };
  }
  if (!scenarioRegistry || typeof scenarioRegistry.resolve !== 'function') {
    return {
      ok: false,
      blockers: [blocker(
        'verification-production:scenario-registry-required',
        testCase.id,
        testCase.runner.scenario_id
      )]
    };
  }
  try {
    const value = scenarioRegistry.resolve(testCase.runner.scenario_id);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('scenario missing');
    }
    return { ok: true, value, blockers: [] };
  } catch (error) {
    return {
      ok: false,
      blockers: [blocker(
        'verification-production:scenario-resolution-failed',
        testCase.id,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
}

function executionRequest(context) {
  const {
    testCase,
    approval,
    runtimeStatus,
    run,
    attempt,
    previousAttempts,
    projectRoot,
    protocolFile,
    artifactRoot,
    environment,
    scenario
  } = context;
  const base = {
    approvalInput: approval,
    runtimeStatus,
    run,
    caseId: testCase.id,
    attempt,
    previousAttempts
  };
  if (testCase.runner.kind === 'command') {
    return {
      method: 'executeCommand',
      input: {
        ...base,
        command: {
          argv: [testCase.runner.entrypoint, ...testCase.runner.args],
          cwd: path.resolve(projectRoot, testCase.runner.cwd),
          env: environment.env
        },
        protocolFile
      }
    };
  }
  if (testCase.runner.kind === 'playwright') {
    return {
      method: 'executePlaywright',
      input: {
        ...base,
        playwright: {
          scenario_id: testCase.runner.scenario_id,
          scenario_hash: testCase.runner.scenario_hash,
          browser_project: testCase.runner.browser_project,
          allowed_origins: [...testCase.runner.allowed_origins],
          artifact_root: artifactRoot,
          scenario_data: scenario.scenario_data ?? null,
          scenario: scenario.scenario
        }
      }
    };
  }
  return {
    method: 'executeMidscene',
    input: {
      ...base,
      midscene: {
        scenario_id: testCase.runner.scenario_id,
        scenario_hash: testCase.runner.scenario_hash,
        browser_project: testCase.runner.browser_project,
        allowed_origins: [...testCase.runner.allowed_origins],
        artifact_root: artifactRoot,
        prompt_id: testCase.runner.prompt_id,
        prompt_hash: testCase.runner.prompt_hash,
        prompt: scenario.prompt,
        start_url: testCase.runner.start_url,
        oracle_scenario_hash: testCase.runner.oracle_scenario_hash,
        oracle_scenario: scenario.oracle_scenario,
        scenario_data: scenario.scenario_data ?? null,
        interaction: scenario.interaction
      },
      ...(scenario.signoff ? { signoff: scenario.signoff } : {})
    }
  };
}

function executionForReading(testCase, execution, protocol) {
  if (testCase.runner.kind === 'command') {
    return {
      status: execution.status,
      assertions: protocol.results,
      oracle: {
        type: 'deterministic',
        producer: 'command-runner',
        facts: protocol.results.map((entry) => ({
          assertion_id: entry.id,
          expected: entry.expected,
          actual: entry.actual,
          status: entry.status
        }))
      },
      blockers: [...execution.blockers, ...protocol.blockers]
    };
  }
  return {
    status: execution.status,
    assertions: Array.isArray(execution.assertions)
      ? execution.assertions
      : [],
    oracle: execution.oracle || {
      type: 'deterministic',
      producer: testCase.runner.kind === 'midscene'
        ? 'midscene-runner'
        : 'playwright-runner',
      facts: []
    },
    blockers: [...execution.blockers]
  };
}

function failureProjection(context) {
  const {
    kernel,
    schemaRegistry,
    testCase,
    execution,
    readings,
    evidence,
    integrity,
    clock
  } = context;
  const failed = readings.filter((entry) => (
    ['fail', 'blocked'].includes(entry.verdict)
  ));
  if (failed.length === 0) {
    return { packet: null, blockers: [] };
  }
  const evidenceIds = new Set(failed.flatMap((entry) => entry.evidence_ids));
  const selectedEvidence = evidence.filter((entry) => evidenceIds.has(entry.id));
  const selectedFacts = integrity.facts.evidence.filter((entry) => (
    evidenceIds.has(entry.evidence_id)
  ));
  const failedAssertionIds = [...new Set(
    failed.map((entry) => entry.assertion_id)
  )].sort();
  const rootCauseCheck = {
    id: `root-cause-${execution.attempt.id}`,
    trusted: true,
    change_id: execution.run.change_id,
    run_id: execution.run.id,
    case_id: testCase.id,
    attempt_id: execution.attempt.id,
    classification: null,
    summary: `Verification did not pass for ${testCase.id}.`,
    root_cause: 'Classification is required before retry or development repair.',
    failed_assertion_ids: failedAssertionIds
  };
  const classified = kernel.createFailureClassifier({
    schemaRegistry,
    rootCauseChecks: [rootCauseCheck],
    clock,
    noProgressThreshold: 3
  }).classify({
    readings: failed,
    evidence: selectedEvidence,
    integrity: {
      ok: integrity.ok,
      facts: {
        summary: {
          evidence_count: selectedFacts.length,
          integrity: integrity.facts.summary.integrity,
          freshness: integrity.facts.summary.freshness
        },
        evidence: selectedFacts
      },
      blockers: integrity.blockers.filter((entry) => (
        evidenceIds.has(entry.artifact)
      ))
    },
    root_cause_check_id: rootCauseCheck.id,
    no_progress_count: 0
  });
  if (classified.packet) {
    return {
      packet: classified.packet,
      blockers: classified.blockers.filter((entry) => (
        entry.id !== 'verification-failure:classification-missing'
      ))
    };
  }
  return { packet: null, blockers: classified.blockers };
}

function createProductionVerificationRunner(options = {}) {
  const {
    kernel,
    schemaRegistry,
    projectRoot,
    changeRoot,
    verificationRoot,
    runtimeStatus,
    snapshot,
    approval,
    requirements,
    acceptance,
    reviewerId,
    codeSha,
    testSha,
    environmentHash,
    generation,
    clock = () => new Date().toISOString(),
    secrets = [],
    scenarioRegistry = null,
    repairIdentityResolver = null,
    providerEnvironment = {},
    commandAdapter = null,
    playwrightAdapter = null,
    midsceneAdapter = null
  } = options;
  if (
    !kernel
    || !schemaRegistry
    || typeof projectRoot !== 'string'
    || typeof changeRoot !== 'string'
    || typeof verificationRoot !== 'string'
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-production:config-invalid');
  }
  const approvalValidator = require('../cases').createCaseApprovalValidator({
    schemaRegistry
  });
  const crossReferenceValidator = require(
    '../contracts/cross-reference-validator'
  ).createCrossReferenceValidator({ schemaRegistry });
  const approvalState = approvalValidator.evaluate(approvalInput({
    snapshot,
    approval,
    requirements,
    acceptance,
    reviewerId
  }));
  const orchestrator = kernel.createExecutionOrchestrator({
    approvalValidator,
    schemaRegistry,
    commandAdapter: commandAdapter || kernel.createCommandAdapter(),
    playwrightAdapter: playwrightAdapter || kernel.createPlaywrightAdapter(),
    midsceneAdapter: midsceneAdapter || kernel.createMidsceneAdapter({
      providerEnvironment
    }),
    crossReferenceValidator,
    projectRoot,
    clock: { now: clock }
  });
  const artifactStore = kernel.createVerificationArtifactStore({
    changeRoot,
    root: verificationRoot
  });
  const evidenceStore = kernel.createEvidenceStore({
    root: path.join(verificationRoot, 'evidence'),
    changeRoot,
    changeId: snapshot?.change_id || 'change-unknown',
    sourceRoot: projectRoot,
    schemaRegistry,
    clock
  });
  const integrityChecker = kernel.createEvidenceIntegrityChecker({
    evidenceStore,
    crossReferenceValidator,
    registeredProducers: [...REGISTERED_PRODUCERS],
    clock
  });
  const readingEvaluator = kernel.createReadingEvaluator({
    schemaRegistry,
    clock
  });
  const redactor = kernel.createSecretRedactor({ secrets });

  async function executeCase(caseId, executionOptions = {}) {
    if (!approvalState.ok) {
      return {
        ok: false,
        status: 'blocked',
        blockers: approvalState.blockers,
        fallback_used: false
      };
    }
    if (
      !generation
      || typeof generation.id !== 'string'
      || generation.change_id !== snapshot.change_id
      || generation.snapshot_id !== snapshot.id
      || generation.snapshot_hash !== snapshot.snapshot_hash
      || generation.fingerprints?.case_snapshot_hash
        !== snapshot.snapshot_hash
      || generation.fingerprints?.code_sha !== codeSha
      || generation.fingerprints?.test_sha !== testSha
      || generation.fingerprints?.environment_hash !== environmentHash
      || generation.fingerprints?.runtime_version
        !== runtimeStatus.runtime_version
      || generation.fingerprints?.kernel_version !== kernel.metadata.version
    ) {
      return {
        ok: false,
        status: 'blocked',
        blockers: [blocker(
          'verification-generation:active-required',
          caseId
        )],
        fallback_used: false
      };
    }
    const testCase = snapshot.cases.find((entry) => entry.id === caseId);
    if (!testCase) {
      return {
        ok: false,
        status: 'blocked',
        blockers: [blocker(
          'verification-production:approved-case-missing',
          caseId
        )],
        fallback_used: false
      };
    }
    if (!['command', 'playwright', 'midscene'].includes(testCase.runner.kind)) {
      return {
        ok: false,
        status: 'blocked',
        blockers: [blocker(
          'verification-production:runner-unsupported',
          caseId,
          testCase.runner.kind
        )],
        fallback_used: false
      };
    }
    const scenario = resolveScenario(scenarioRegistry, testCase);
    if (!scenario.ok) {
      return {
        ok: false,
        status: 'blocked',
        blockers: scenario.blockers,
        fallback_used: false
      };
    }
    const now = clock();
    let repairIdentity = null;
    if (
      ['retest', 'regression'].includes(
        executionOptions.kind || 'initial'
      )
    ) {
      if (typeof repairIdentityResolver !== 'function') {
        return {
          ok: false,
          status: 'blocked',
          blockers: [blocker(
            'verification-production:repair-identity-resolver-required',
            executionOptions.failureId || caseId
          )],
          fallback_used: false
        };
      }
      const resolved = repairIdentityResolver(executionOptions.failureId);
      if (!resolved?.ok || !resolved.identity) {
        return {
          ok: false,
          status: 'blocked',
          blockers: resolved?.blockers || [blocker(
            'verification-production:repair-identity-unavailable',
            executionOptions.failureId || caseId
          )],
          fallback_used: false
        };
      }
      repairIdentity = resolved.identity;
    }
    const prepared = makeFollowupRun({
      snapshot,
      runtimeStatus,
      codeSha,
      testSha,
      environmentHash,
      kernelVersion: kernel.metadata.version,
      generationId: generation.id
    }, testCase, now, {
      ...executionOptions,
      repairIdentity
    }, executionHistory(verificationRoot));
    if (!prepared.ok) {
      return {
        ok: false,
        status: 'blocked',
        blockers: prepared.blockers,
        fallback_used: false
      };
    }
    const { identity, previousAttempts } = prepared;
    const runRoot = path.join(
      verificationRoot,
      'runs',
      identity.run.id
    );
    const attemptRoot = path.join(
      runRoot,
      'attempts',
      identity.attempt.id
    );
    const protocolFile = path.join(attemptRoot, 'assertion-results.jsonl');
    const artifactRoot = path.join(attemptRoot, 'runner-artifacts');
    fs.mkdirSync(attemptRoot, { recursive: true });
    fs.mkdirSync(artifactRoot, { recursive: true });
    const environment = testCase.runner.kind === 'command'
      ? commandEnvironment(testCase, {
          protocolFile,
          artifactRoot,
          attemptId: identity.attempt.id
        }, {
          ...process.env,
          ...providerEnvironment
        })
      : { ok: true, env: {}, blockers: [] };
    if (!environment.ok) {
      return {
        ok: false,
        status: 'blocked',
        blockers: environment.blockers,
        fallback_used: false
      };
    }
    const approved = approvalInput({
        snapshot,
        approval,
        requirements,
        acceptance,
        reviewerId
    });
    const request = executionRequest({
      testCase,
      approval: approved,
      runtimeStatus,
      run: identity.run,
      attempt: identity.attempt,
      previousAttempts,
      projectRoot,
      protocolFile,
      artifactRoot,
      environment,
      scenario: scenario.value
    });
    const execution = await orchestrator[request.method](request.input);
    if (!execution.run || !execution.attempt) {
      try {
        if (fs.existsSync(runRoot)) {
          fs.rmSync(runRoot, { recursive: true, force: true });
        }
      } catch {
        // The structured execution blocker remains authoritative.
      }
      return {
        ok: false,
        status: 'blocked',
        execution,
        blockers: execution.blockers || [blocker(
          'verification-production:execution-artifacts-unavailable',
          caseId
        )],
        fallback_used: false
      };
    }
    const blockers = persistExecution(artifactStore, execution);
    const protocolRead = testCase.runner.kind === 'command'
      ? readJsonl(protocolFile)
      : { ok: true, values: [], blockers: [] };
    blockers.push(...protocolRead.blockers);
    const protocol = testCase.runner.kind === 'command'
      ? exactProtocol(testCase, protocolRead.values)
      : { ok: true, results: [], blockers: [] };
    blockers.push(...protocol.blockers);
    const readingExecution = executionForReading(
      testCase,
      execution,
      protocol
    );
    const candidates = testCase.runner.kind === 'command'
      ? evidenceRequests({
          testCase,
          execution,
          protocol,
          redactor,
          artifactRoot,
          capturedAt: clock()
        })
      : browserEvidenceRequests({
          testCase,
          execution,
          redactor,
          capturedAt: clock()
        });
    blockers.push(...candidates.blockers);
    const stored = appendEvidence(evidenceStore, candidates.requests);
    blockers.push(...stored.blockers);
    const currentFingerprints = {
      case_snapshot_hash: snapshot.snapshot_hash,
      code_sha: codeSha,
      test_sha: testSha,
      environment_hash: environmentHash,
      runtime_version: runtimeStatus.runtime_version,
      kernel_version: kernel.metadata.version
    };
    const initialIntegrity = integrityChecker.checkIntegrity({
      activeChangeId: snapshot.change_id,
      caseSnapshot: snapshot,
      run: execution.run,
      attempts: execution.attempts,
      readings: [],
      evidence: stored.evidence,
      currentFingerprints
    });
    const readingResult = readingEvaluator.evaluate({
      testCase,
      run: execution.run,
      attempt: execution.attempt,
      execution: readingExecution,
      evidence: stored.evidence,
      integrity: initialIntegrity
    });
    blockers.push(...readingResult.blockers);
    const finalIntegrity = integrityChecker.checkIntegrity({
      activeChangeId: snapshot.change_id,
      caseSnapshot: snapshot,
      run: execution.run,
      attempts: execution.attempts,
      readings: readingResult.readings,
      evidence: stored.evidence,
      currentFingerprints
    });
    blockers.push(...finalIntegrity.blockers);
    const readingWrite = artifactStore.appendJsonl(
      `runs/${execution.run.id}/readings.jsonl`,
      readingResult.readings
    );
    if (!readingWrite.ok) blockers.push(...readingWrite.blockers);
    const attemptIntegrityWrite = artifactStore.publishImmutableJson(
      [
        'runs',
        execution.run.id,
        'attempts',
        execution.attempt.id,
        'integrity.json'
      ].join('/'),
      finalIntegrity
    );
    if (!attemptIntegrityWrite.ok) {
      blockers.push(...attemptIntegrityWrite.blockers);
    }
    const runIntegrity = aggregateRunIntegrity(
      artifactStore,
      execution,
      finalIntegrity
    );
    blockers.push(...runIntegrity.blockers);
    const runIntegrityWrite = artifactStore.publishJson(
      `runs/${execution.run.id}/integrity.json`,
      runIntegrity
    );
    if (!runIntegrityWrite.ok) blockers.push(...runIntegrityWrite.blockers);
    const failure = failureProjection({
      kernel,
      schemaRegistry,
      testCase,
      execution,
      readings: readingResult.readings,
      evidence: stored.evidence,
      integrity: finalIntegrity,
      clock
    });
    blockers.push(...failure.blockers);
    if (failure.packet) {
      const runFailureWrite = artifactStore.appendJsonl(
        `runs/${execution.run.id}/failures.jsonl`,
        failure.packet
      );
      if (!runFailureWrite.ok) {
        blockers.push(...runFailureWrite.blockers);
      }
    }

    const runsFile = path.join(verificationRoot, 'v2', 'runs.json');
    const attemptsFile = path.join(verificationRoot, 'v2', 'attempts.json');
    const readingsFile = path.join(verificationRoot, 'v2', 'readings.json');
    const executionsFile = path.join(verificationRoot, 'v2', 'executions.json');
    const failuresFile = path.join(verificationRoot, 'v2', 'failures.json');
    const projections = [
      artifactStore.publishJson(
        'v2/runs.json',
        mergeById(currentProjection(runsFile), [execution.run])
      ),
      artifactStore.publishJson(
        'v2/attempts.json',
        mergeById(currentProjection(attemptsFile), [execution.attempt])
      ),
      artifactStore.publishJson(
        'v2/readings.json',
        mergeById(currentProjection(readingsFile), readingResult.readings)
      ),
      artifactStore.publishJson(
        'v2/executions.json',
        mergeById(currentProjection(executionsFile), [{
          id: `execution-${execution.attempt.id}`,
          run_id: execution.run.id,
          attempt_id: execution.attempt.id,
          case_id: caseId,
          status: execution.status,
          assertions: protocol.results,
          blockers: [...execution.blockers, ...protocol.blockers],
          recorded_at: clock()
        }])
      ),
      ...(failure.packet
        ? [artifactStore.publishJson(
            'v2/failures.json',
            mergeById(
              currentProjection(failuresFile),
              [failure.packet]
            )
          )]
        : [])
    ];
    blockers.push(...projections.flatMap((entry) => (
      entry.ok ? [] : entry.blockers
    )));
    return {
      ok: execution.ok
        && protocol.ok
        && initialIntegrity.ok
        && readingResult.ok
        && finalIntegrity.ok
        && blockers.length === 0,
      status: blockers.length > 0
        ? 'blocked'
        : readingResult.status === 'fail'
          ? 'failed'
          : execution.status,
      run: execution.run,
      attempt: execution.attempt,
      execution: readingExecution,
      evidence: stored.evidence,
      integrity: finalIntegrity,
      readings: readingResult.readings,
      failure_packet: failure.packet,
      repair_handoff: failure.packet && execution.attempt.kind === 'initial' ? {
        failure_id: failure.packet.id,
        status: 'classification_required',
        next_action: 'classify_failure',
        next_skill: 'specnav-verify-rerun'
      } : null,
      blockers,
      fallback_used: false
    };
  }

  return Object.freeze({
    approvalState,
    executeCase
  });
}

module.exports = {
  PROTOCOL_ENV,
  REGISTERED_PRODUCERS,
  browserEvidenceRequests,
  createProductionVerificationRunner,
  exactProtocol,
  evidenceRequests,
  mergeIntegrityResults,
  makeFollowupRun,
  makeInitialRun
};
