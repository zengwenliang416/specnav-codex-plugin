#!/usr/bin/env node
'use strict';

// Computes exact case-level rerun scope from approved cases, freshness,
// traceability, repair state, mandatory policy baselines, and optional
// CodeGraph impact evidence. Domain output remains compatibility metadata.

const path = require('path');
const fs = require('fs');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const {
  ALL_DOMAINS,
  createCaseRerunPlanner
} = require('../kernel/repair');
const {
  createCaseApprovalValidator
} = require('../kernel/cases');
const {
  readySchemaRegistry
} = require('../skills/specnav-verify-plan/scripts/case-contract');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function changedFiles(projectRoot, baseRef) {
  const ref = baseRef || 'HEAD';
  const result = lib.runCommand(`git diff --name-only ${lib.shellQuote(ref)}`, {
    cwd: projectRoot,
    timeoutMs: 30000
  });
  if (!result.ok) return { ok: false, error: result.stderr.trim() || `git diff exited ${result.status}`, files: [] };
  const untracked = lib.runCommand('git ls-files --others --exclude-standard', {
    cwd: projectRoot,
    timeoutMs: 30000
  });
  const files = new Set(
    result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  );
  if (untracked.ok) {
    for (const line of untracked.stdout.split(/\r?\n/)) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return { ok: true, files: Array.from(files).filter((file) => !file.startsWith('openspec/')) };
}

function artifact(projectRoot, changeDir, options, name, relativePath) {
  const explicit = options[name];
  const file = explicit
    ? path.resolve(projectRoot, explicit)
    : path.join(changeDir, relativePath);
  return {
    file,
    value: lib.readJson(file, null),
    exists: fs.existsSync(file)
  };
}

function blockerDetail(id, artifactName, detail = null) {
  return {
    id,
    artifact: artifactName,
    detail
  };
}

function blockerIds(blockers) {
  return Array.from(new Set((blockers || []).map((entry) => (
    typeof entry === 'string' ? entry : entry?.id
  )).filter(Boolean)));
}

function missingArtifact(change, name) {
  const blockers = [
    blockerDetail(
      `missing-verify-artifact:${name}`,
      name
    )
  ];
  return {
    ok: false,
    change,
    blockers,
    blocker_ids: blockerIds(blockers),
    required_cases: [],
    baseline_cases: [],
    repaired_cases: [],
    impacted_cases: [],
    stale_cases: [],
    cases_to_rerun: [],
    reasons_by_case: {},
    changed_files: [],
    unmapped_changes: [],
    full_rerun: true,
    domains_to_rerun: ALL_DOMAINS,
    codegraph_refs: [],
    policy_refs: [],
    warnings: []
  };
}

function invalidArtifact(change, name, detail = null) {
  const result = missingArtifact(change, name);
  result.blockers = [
    blockerDetail(
      `invalid-verify-artifact:${name}`,
      name,
      detail
    )
  ];
  result.blocker_ids = blockerIds(result.blockers);
  return result;
}

function computeRerunScope(projectRoot, options = {}) {
  const changeState = lib.activeChangeState(projectRoot, options.change !== undefined ? { change: options.change } : {});
  const change = changeState.change;
  if (!change) {
    const blockers = (
      changeState.blockers.length
        ? changeState.blockers
        : ['active-change']
    ).map((entry) => (
      typeof entry === 'string'
        ? blockerDetail(entry, 'active-change')
        : entry
    ));
    return {
      ok: false,
      change: null,
      blockers,
      blocker_ids: blockerIds(blockers)
    };
  }
  const changeDir = lib.changeDir(projectRoot, change);
  const matrixArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'traceabilityPath',
    'verify/traceability-matrix.json'
  );
  if (!matrixArtifact.exists) {
    return missingArtifact(change, 'traceability-matrix.json');
  }
  if (
    !matrixArtifact.value
    || !Array.isArray(matrixArtifact.value.entries)
  ) {
    return invalidArtifact(
      change,
      'traceability-matrix.json',
      'entries'
    );
  }
  const caseArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'caseSnapshotPath',
    'verify/v2/case-snapshot.json'
  );
  if (!caseArtifact.exists) {
    return missingArtifact(change, 'case-snapshot.json');
  }
  if (!caseArtifact.value) {
    return invalidArtifact(change, 'case-snapshot.json');
  }
  const freshnessArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'freshnessPath',
    'verify/v2/freshness.json'
  );
  if (!freshnessArtifact.exists) {
    return missingArtifact(change, 'case-freshness.json');
  }
  if (
    !freshnessArtifact.value
    || !Array.isArray(freshnessArtifact.value.cases)
  ) {
    return invalidArtifact(change, 'case-freshness.json', 'cases');
  }
  const approvalArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'caseApprovalPath',
    'verify/v2/case-approval.json'
  );
  if (!approvalArtifact.exists) {
    return missingArtifact(change, 'case-approval.json');
  }
  if (!approvalArtifact.value) {
    return invalidArtifact(change, 'case-approval.json');
  }
  const requirementsArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'requirementsSourcePath',
    'verify/v2/requirements-source.json'
  );
  if (!requirementsArtifact.exists) {
    return missingArtifact(change, 'current-requirements.json');
  }
  if (!Array.isArray(requirementsArtifact.value)) {
    return invalidArtifact(change, 'current-requirements.json');
  }
  const acceptanceArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'acceptanceSourcePath',
    'verify/v2/acceptance-source.json'
  );
  if (!acceptanceArtifact.exists) {
    return missingArtifact(change, 'current-acceptance.json');
  }
  if (!Array.isArray(acceptanceArtifact.value)) {
    return invalidArtifact(change, 'current-acceptance.json');
  }
  if (
    typeof options.expectedReviewerId !== 'string'
    || !options.expectedReviewerId.trim()
  ) {
    return invalidArtifact(
      change,
      'case-approval-reviewer',
      'verification-rerun:approval-principal-missing'
    );
  }
  const policyArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'policyPath',
    'verify/rerun-policy.json'
  );
  if (!policyArtifact.exists) {
    return missingArtifact(change, 'rerun-policy.json');
  }
  if (
    !policyArtifact.value
    || !Array.isArray(policyArtifact.value.mandatory_baseline_case_ids)
    || (
      policyArtifact.value.policy_refs !== undefined
      && !Array.isArray(policyArtifact.value.policy_refs)
    )
  ) {
    return invalidArtifact(change, 'rerun-policy.json');
  }
  const codegraphArtifact = artifact(
    projectRoot,
    changeDir,
    options,
    'codegraphImpactPath',
    'codegraph/impact-report.json'
  );

  const diff = options.files
    ? { ok: true, files: options.files }
    : changedFiles(projectRoot, options.baseRef);
  if (!diff.ok) {
    const blockers = [
      blockerDetail(
        'git-diff-failed',
        'git-diff',
        diff.error
      )
    ];
    return {
      ...missingArtifact(change, 'git-diff'),
      blockers,
      blocker_ids: blockerIds(blockers)
    };
  }

  const matrix = matrixArtifact.value;
  const policy = policyArtifact.value;
  let schemaRegistry;
  try {
    schemaRegistry = options.schemaRegistry || readySchemaRegistry();
  } catch (error) {
    const blockers = (
      Array.isArray(error?.blockers)
        ? error.blockers
        : [
            blockerDetail(
              'verification-rerun:schema-registry-unavailable',
              'verification-runtime'
            )
          ]
    ).map((entry) => (
      typeof entry === 'string'
        ? blockerDetail(entry, 'verification-runtime')
        : entry
    ));
    return {
      ...missingArtifact(change, 'verification-runtime'),
      blockers,
      blocker_ids: blockerIds(blockers)
    };
  }
  const planner = createCaseRerunPlanner({
    caseApprovalValidator: createCaseApprovalValidator({ schemaRegistry })
  });
  const result = planner.plan({
    caseCatalog: caseArtifact.value,
    caseApproval: approvalArtifact.value,
    currentRequirements: requirementsArtifact.value,
    currentAcceptance: acceptanceArtifact.value,
    expectedReviewerId: options.expectedReviewerId,
    changedFiles: diff.files,
    traceabilityEntries: Array.isArray(matrix.entries) ? matrix.entries : null,
    freshnessFacts: freshnessArtifact.value,
    repairedCaseIds: options.repairedCaseIds || [],
    mandatoryBaselineCaseIds: policy.mandatory_baseline_case_ids,
    policyRefs: policy.policy_refs || [],
    codegraphImpact: codegraphArtifact.exists
      ? codegraphArtifact.value
      : null
  });
  const invalidated = Array.isArray(matrix.entries)
    ? matrix.entries
      .filter((entry) => (
        entry
        && diff.files.includes(entry.changed_file)
      ))
      .map((entry) => ({
        changed_file: entry.changed_file,
        case_ids: entry.case_ids || [],
        requirement_refs: entry.requirement_refs || [],
        acceptance_refs: entry.acceptance_refs || [],
        task_refs: entry.task_refs || []
      }))
    : [];

  return {
    ...result,
    change,
    invalidated_entries: invalidated,
    blocker_ids: blockerIds(result.blockers)
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write([
      'Usage: rerun-scope.js [--change <id>] [--base <ref>] [--files <paths>]',
      '  [--repaired <case-ids>] [--case-snapshot <file>]',
      '  [--case-approval <file>] [--requirements-source <file>]',
      '  [--acceptance-source <file>] --reviewer-id <id>',
      '  [--freshness <file>] [--policy <file>] [--traceability <file>]',
      '  [--codegraph-impact <file>] [--json]',
      ''
    ].join('\n'));
    process.exit(0);
  }
  const root = lib.projectRoot();
  const change = argValue(args, '--change', null);
  const baseRef = argValue(args, '--base', null);
  const filesArg = argValue(args, '--files', null);
  const repairedArg = argValue(args, '--repaired', null);
  const sourceResult = computeRerunScope(root, {
    ...(change ? { change } : {}),
    ...(baseRef ? { baseRef } : {}),
    ...(filesArg ? { files: filesArg.split(',').map((file) => file.trim()).filter(Boolean) } : {}),
    repairedCaseIds: repairedArg
      ? repairedArg.split(',').map((caseId) => caseId.trim()).filter(Boolean)
      : [],
    caseSnapshotPath: argValue(args, '--case-snapshot', null),
    caseApprovalPath: argValue(args, '--case-approval', null),
    requirementsSourcePath: argValue(args, '--requirements-source', null),
    acceptanceSourcePath: argValue(args, '--acceptance-source', null),
    expectedReviewerId: argValue(args, '--reviewer-id', null),
    freshnessPath: argValue(args, '--freshness', null),
    policyPath: argValue(args, '--policy', null),
    traceabilityPath: argValue(args, '--traceability', null),
    codegraphImpactPath: argValue(args, '--codegraph-impact', null)
  });
  const result = {
    ...sourceResult,
    fallback_used: false
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { computeRerunScope, ALL_DOMAINS };
