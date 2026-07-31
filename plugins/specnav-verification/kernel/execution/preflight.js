'use strict';

const { deepFreeze } = require('../contracts/schema-registry');
const { validateApprovedCommand } = require('./command-contract');

function executionBlocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function blockedResult(previousAttempts, blockers) {
  return deepFreeze({
    ok: false,
    status: 'blocked',
    run: null,
    attempt: null,
    run_states: [],
    attempt_states: [],
    attempts: structuredClone(previousAttempts),
    command: null,
    logs: { stdout: '', stderr: '' },
    events: [],
    blockers
  });
}

function validateArtifact(schemaRegistry, entityType, value) {
  try {
    return {
      value: schemaRegistry.assertValid(entityType, value),
      blockers: []
    };
  } catch (error) {
    return {
      value: null,
      blockers: [
        executionBlocker(
          `verification-execution:${entityType}-invalid`,
          entityType,
          error instanceof Error ? error.message : String(error)
        ),
        ...(Array.isArray(error?.blockers) ? error.blockers : [])
      ]
    };
  }
}

function validateRuntime(runtimeStatus, run) {
  if (
    runtimeStatus
    && runtimeStatus.ok === true
    && runtimeStatus.readiness === 'ready'
    && runtimeStatus.fallback_used === false
    && runtimeStatus.runtime_version === run.runtime_version
  ) {
    return null;
  }
  const detail = Array.isArray(runtimeStatus?.blockers)
    ? runtimeStatus.blockers.map((entry) => entry?.id).filter(Boolean).join(',')
    : '';
  return executionBlocker(
    'verification-execution:runtime-not-ready',
    'runtime-status',
    detail || null
  );
}

function validateRunApproval(run, approvalResult, caseId) {
  const snapshot = approvalResult.snapshot;
  const checks = [
    ['change_id', snapshot.change_id],
    ['case_snapshot_id', snapshot.id],
    ['case_snapshot_hash', snapshot.snapshot_hash]
  ];
  for (const [field, expected] of checks) {
    if (run[field] !== expected) {
      return executionBlocker(
        'verification-execution:run-approval-mismatch',
        run.id,
        field
      );
    }
  }
  if (!run.case_ids.includes(caseId)) {
    return executionBlocker(
      'verification-execution:run-approval-mismatch',
      run.id,
      'case_ids'
    );
  }
  return null;
}

function validateReferenceGraph(validator, values) {
  const result = validator.validateCrossReferences({
    activeChangeId: values.run.change_id,
    caseSnapshot: values.snapshot,
    run: values.run,
    attempts: values.attempts,
    readings: [],
    evidence: []
  });
  return result.ok ? null : result.blockers;
}

function runPreflight(input, dependencies) {
  const previousAttempts = Array.isArray(input.previousAttempts)
    ? structuredClone(input.previousAttempts)
    : [];
  let approvalResult;
  try {
    approvalResult = dependencies.approvalValidator.assertExecutionApproved(
      input.approvalInput
    );
  } catch (error) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [
        executionBlocker(
          'verification-execution:approval-blocked',
          'case-approval',
          error instanceof Error ? error.message : String(error)
        ),
        ...(Array.isArray(error?.blockers) ? error.blockers : [])
      ])
    };
  }

  const runValidation = validateArtifact(
    dependencies.schemaRegistry,
    'verification-run',
    input.run
  );
  if (!runValidation.value) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, runValidation.blockers)
    };
  }
  const run = runValidation.value;
  const runtimeProblem = validateRuntime(input.runtimeStatus, run);
  if (runtimeProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [runtimeProblem])
    };
  }

  const commandValidation = dependencies.commandAdapter.validate(input.command);
  if (!commandValidation.ok) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, commandValidation.blockers)
    };
  }
  const testCase = approvalResult.snapshot.cases.find((entry) => (
    entry.id === input.caseId
  ));
  if (!testCase) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:approved-case-missing',
        'case-snapshot'
      )])
    };
  }
  if (testCase.runner.kind !== 'command') {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [executionBlocker(
        'verification-execution:runner-kind-mismatch',
        testCase.id,
        testCase.runner.kind
      )])
    };
  }
  const commandProblem = validateApprovedCommand(
    testCase,
    input.command,
    dependencies.projectRoot
  );
  if (commandProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [commandProblem])
    };
  }
  const runProblem = validateRunApproval(run, approvalResult, input.caseId);
  if (runProblem) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, [runProblem])
    };
  }
  const graphProblems = validateReferenceGraph(
    dependencies.crossReferenceValidator,
    {
      run,
      snapshot: approvalResult.snapshot,
      attempts: previousAttempts
    }
  );
  if (graphProblems) {
    return {
      ok: false,
      result: blockedResult(previousAttempts, graphProblems)
    };
  }
  return {
    ok: true,
    approvalResult,
    testCase,
    run,
    previousAttempts
  };
}

module.exports = {
  blockedResult,
  executionBlocker,
  runPreflight,
  validateArtifact,
  validateReferenceGraph,
  validateRunApproval,
  validateRuntime
};
