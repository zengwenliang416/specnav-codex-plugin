#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const { guard: validateCodeGraph } = runtime.requirePluginScript('specnav-codegraph', 'scripts/codegraph-contract');

const TARGETS = new Set(['local-only', 'plugin-marketplace', 'package', 'host-compatibility', 'project-deploy']);
const RECEIPT_CONFIDENCE = new Set(['A', 'B', 'C']);
const UPDATE_SPEC_STATUSES = new Set(['no_writeback_needed', 'written_back', 'deferred']);

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function codegraphStageGuard(projectRoot, change, stage) {
  if (!change) return null;
  return validateCodeGraph({
    projectRoot,
    change,
    stage,
    requireEvidence: true,
    writeArtifacts: true
  });
}

function codegraphBlockers(result) {
  return result && Array.isArray(result.blockers) ? result.blockers : [];
}

function codegraphWarnings(result) {
  return result && Array.isArray(result.warnings) ? result.warnings : [];
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCleanString(value) {
  return typeof value === 'string' && value.trim() !== '' && value === value.trim();
}

function cleanStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isCleanString(item));
}

function readJsonFile(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')), status: 'ok' };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, value: null, status: 'missing' };
    if (error instanceof SyntaxError) return { ok: false, value: null, status: 'invalid-json' };
    return { ok: false, value: null, status: 'unreadable' };
  }
}

function readTextFile(file) {
  try {
    return { ok: true, value: fs.readFileSync(file, 'utf8'), status: 'ok' };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, value: '', status: 'missing' };
    return { ok: false, value: '', status: 'unreadable' };
  }
}

function normalizeHeading(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_()[\]{}:;,.!?/\\|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasHeading(text, heading) {
  const wanted = normalizeHeading(heading);
  return String(text || '')
    .split(/\r?\n/)
    .some((line) => {
      const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
      return match && normalizeHeading(match[1]) === wanted;
    });
}

function hasTodoPlaceholder(text) {
  return /\b(?:TODO|TBD)\b/i.test(String(text || ''));
}

function parseJsonl(file, name, allowMissing = false) {
  const text = readTextFile(file);
  const blockers = [];
  const entries = [];
  if (!text.ok) {
    if (!allowMissing) blockers.push(`missing-operations-artifact:${name}`);
    return { blockers, entries };
  }
  text.value.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const entry = JSON.parse(trimmed);
      if (!isPlainObject(entry)) blockers.push(`invalid-jsonl-shape:${name}:${index + 1}`);
      else entries.push(entry);
    } catch {
      blockers.push(`invalid-jsonl:${name}:${index + 1}`);
    }
  });
  return { blockers, entries };
}

function artifact(change, name, blockers, extra = {}) {
  return {
    name,
    path: change ? path.join('openspec', 'changes', change, 'operations', name) : null,
    ok: blockers.length === 0,
    blockers: unique(blockers),
    ...extra
  };
}

function verifyArtifact(change, name, blockers, extra = {}) {
  return {
    name: `verify/${name}`,
    path: change ? path.join('openspec', 'changes', change, 'verify', name) : null,
    ok: blockers.length === 0,
    blockers: unique(blockers),
    ...extra
  };
}

function changeArtifact(change, name, blockers, extra = {}) {
  return {
    name,
    path: change ? path.join('openspec', 'changes', change, name) : null,
    ok: blockers.length === 0,
    blockers: unique(blockers),
    ...extra
  };
}

function validateText(opsDir, change, name, headings = []) {
  const text = readTextFile(path.join(opsDir, name));
  const blockers = [];
  if (!text.ok) return artifact(change, name, [`missing-operations-artifact:${name}`]);
  if (text.value.trim() === '') blockers.push(`empty-operations-artifact:${name}`);
  if (hasTodoPlaceholder(text.value)) blockers.push(`placeholder-operations-artifact:${name}`);
  for (const heading of headings) {
    if (!hasHeading(text.value, heading)) blockers.push(`missing-heading:${name}:${heading}`);
  }
  return artifact(change, name, blockers);
}

function validateRequiredText(opsDir, change, name) {
  return validateText(opsDir, change, name);
}

function validateTasksMarkdown(changeDir, change) {
  const name = 'tasks.md';
  const text = readTextFile(path.join(changeDir, name));
  const blockers = [];

  if (!text.ok) return changeArtifact(change, name, [`missing-change-artifact:${name}`]);
  if (text.value.trim() === '') blockers.push(`empty-change-artifact:${name}`);

  const taskItems = text.value
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => ({
      checked: match[1] ? match[1].toLowerCase() === 'x' : null,
      text: match[2].trim()
    }))
    .filter((item) => item.text);
  const checkboxItems = taskItems.filter((item) => item.checked !== null);
  const completedItems = checkboxItems.filter((item) => item.checked);
  const incompleteItems = checkboxItems.filter((item) => !item.checked);

  if (taskItems.length === 0) blockers.push('tasks-md:no-bullets');
  if (taskItems.length > 0 && checkboxItems.length === 0) blockers.push('tasks-md:no-checkboxes');
  if (checkboxItems.length > 0 && checkboxItems.length !== taskItems.length) blockers.push('tasks-md:mixed-checkboxes');
  if (incompleteItems.length > 0) blockers.push('tasks-md:incomplete-checkboxes');
  if (checkboxItems.length > 0 && completedItems.length === 0) blockers.push('tasks-md:no-completed-checkboxes');

  return changeArtifact(change, name, blockers, {
    bullet_count: taskItems.length,
    checkbox_count: checkboxItems.length,
    completed_count: completedItems.length,
    incomplete_count: incompleteItems.length
  });
}

function validateVerification(changeDir, change, hasSignoff) {
  const artifacts = [];
  const blockers = [];
  const verifyDir = path.join(changeDir, 'verify');

  const aggregate = readJsonFile(path.join(verifyDir, 'aggregate-report.json'));
  const aggregateBlockers = [];
  if (!aggregate.ok) aggregateBlockers.push(aggregate.status === 'invalid-json' ? 'invalid-json:verify/aggregate-report.json' : 'missing-verify-artifact:aggregate-report.json');
  else if (!isPlainObject(aggregate.value) || aggregate.value.verdict !== 'green') aggregateBlockers.push('verification-not-green');
  else if (aggregate.value.active_change && aggregate.value.active_change !== change) aggregateBlockers.push('verification-change-mismatch');
  artifacts.push(verifyArtifact(change, 'aggregate-report.json', aggregateBlockers));

  const aggregateMd = readTextFile(path.join(verifyDir, 'aggregate-report.md'));
  artifacts.push(verifyArtifact(change, 'aggregate-report.md', aggregateMd.ok && aggregateMd.value.trim() !== '' ? [] : ['missing-verify-artifact:aggregate-report.md']));

  const receipt = readJsonFile(path.join(verifyDir, 'receipt.json'));
  const receiptBlockers = [];
  if (!receipt.ok) receiptBlockers.push(receipt.status === 'invalid-json' ? 'invalid-json:verify/receipt.json' : 'missing-verify-artifact:receipt.json');
  else if (!isPlainObject(receipt.value)) receiptBlockers.push('invalid-receipt:shape');
  else {
    if (receipt.value.change_id !== change) receiptBlockers.push('invalid-receipt:change_id');
    if (!Array.isArray(receipt.value.covered_scope) || receipt.value.covered_scope.length === 0) receiptBlockers.push('invalid-receipt:covered_scope');
    if (!Array.isArray(receipt.value.uncovered_scope)) receiptBlockers.push('invalid-receipt:uncovered_scope');
    else if (receipt.value.uncovered_scope.length > 0) receiptBlockers.push('receipt-uncovered-scope');
    if (!Array.isArray(receipt.value.residual_risk)) receiptBlockers.push('invalid-receipt:residual_risk');
    else if (receipt.value.residual_risk.length > 0 && !hasSignoff) receiptBlockers.push('receipt-residual-risk-signoff');
    if (!RECEIPT_CONFIDENCE.has(receipt.value.confidence)) receiptBlockers.push('invalid-receipt:confidence');
  }
  artifacts.push(verifyArtifact(change, 'receipt.json', receiptBlockers));

  const blockerResult = parseJsonl(path.join(verifyDir, 'blocker-classification.jsonl'), 'blocker-classification.jsonl');
  const blockerBlockers = [...blockerResult.blockers];
  blockerResult.entries.forEach((entry, index) => {
    if (entry.status === 'unresolved') blockerBlockers.push(`unresolved-verification-blocker:${entry.domain || index + 1}`);
  });
  artifacts.push(verifyArtifact(change, 'blocker-classification.jsonl', blockerBlockers, { entries: blockerResult.entries.length }));

  const handoff = readTextFile(path.join(changeDir, 'development', 'handoff-to-verify.md'));
  artifacts.push(changeArtifact(change, 'development/handoff-to-verify.md', handoff.ok && handoff.value.trim() !== '' ? [] : ['missing-development-handoff']));

  if (fs.existsSync(path.join(changeDir, 'verify-report.stale'))) {
    blockers.push('fresh-verify');
  }

  blockers.push(...artifacts.flatMap((item) => item.blockers));
  return { blockers: unique(blockers), artifacts };
}

function validateReadiness(opsDir, change, verificationBlockers) {
  const name = 'readiness.json';
  const parsed = readJsonFile(path.join(opsDir, name));
  const blockers = [];
  let readiness = null;
  if (!parsed.ok) return { readiness, artifact: artifact(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-operations-artifact:${name}`]) };
  if (!isPlainObject(parsed.value)) return { readiness, artifact: artifact(change, name, [`invalid-json-shape:${name}`]) };

  readiness = parsed.value;
  if (readiness.schema !== 'specnav.ops.readiness.v1') blockers.push('invalid-readiness:schema');
  if (readiness.change !== change) blockers.push('invalid-readiness:change');
  if (!TARGETS.has(readiness.release_target)) blockers.push('invalid-readiness:release_target');
  if (readiness.ready !== true) blockers.push('readiness-not-ready');

  if (!isPlainObject(readiness.verification)) blockers.push('invalid-readiness:verification');
  else {
    if (readiness.verification.aggregate_verdict !== 'green') blockers.push('readiness-verification-not-green');
    if (!RECEIPT_CONFIDENCE.has(readiness.verification.receipt_confidence)) blockers.push('readiness-invalid-confidence');
    if (!Array.isArray(readiness.verification.uncovered_scope) || readiness.verification.uncovered_scope.length > 0) blockers.push('readiness-uncovered-scope');
    if (!Array.isArray(readiness.verification.residual_risk)) blockers.push('readiness-invalid-residual-risk');
  }

  if (!isPlainObject(readiness.git)) blockers.push('invalid-readiness:git');
  else {
    if (!isCleanString(readiness.git.branch)) blockers.push('readiness-git-branch');
    if (typeof readiness.git.dirty !== 'boolean') blockers.push('readiness-git-dirty');
    if (readiness.git.untracked_reviewed !== true) blockers.push('readiness-untracked-review');
    if (!isCleanString(readiness.git.worktree_mode)) blockers.push('readiness-worktree-mode');
  }

  if (!isPlainObject(readiness.docs)) blockers.push('invalid-readiness:docs');
  else {
    const userFacing = readiness.docs.user_facing !== false;
    if (userFacing && readiness.docs.changelog !== true) blockers.push('readiness-docs-changelog');
    if ((userFacing || readiness.release_target === 'package') && readiness.docs.release_notes !== true) blockers.push('readiness-docs-release-notes');
    if (readiness.release_target === 'plugin-marketplace' && readiness.docs.readme_updated !== true) blockers.push('readiness-docs-readme');
  }

  if (!isPlainObject(readiness.ops)) blockers.push('invalid-readiness:ops');
  if (verificationBlockers.length > 0) blockers.push('readiness-before-verification-green');

  return { readiness, artifact: artifact(change, name, blockers, { release_target: readiness.release_target || null }) };
}

function validateReleaseChecklist(opsDir, change, target) {
  const name = 'release-checklist.json';
  const parsed = readJsonFile(path.join(opsDir, name));
  const blockers = [];
  if (!parsed.ok) return artifact(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-operations-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifact(change, name, [`invalid-json-shape:${name}`]);
  const checklist = parsed.value;
  if (checklist.schema !== 'specnav.ops.releaseChecklist.v1') blockers.push('invalid-release-checklist:schema');
  if (checklist.change !== change) blockers.push('invalid-release-checklist:change');
  if (checklist.release_target !== target) blockers.push('invalid-release-checklist:release_target');
  if (!Array.isArray(checklist.checks) || checklist.checks.length === 0) blockers.push('invalid-release-checklist:checks');
  else {
    checklist.checks.forEach((check, index) => {
      if (!isPlainObject(check) || !isCleanString(check.name)) blockers.push(`invalid-release-checklist-check:${index + 1}`);
      const passed = check.status === 'pass' || check.ok === true;
      if (!passed) blockers.push(`release-checklist-not-passing:${check && check.name ? check.name : index + 1}`);
    });
  }
  return artifact(change, name, blockers);
}

function validateInstallVerification(opsDir, change) {
  const name = 'install-verification.json';
  const parsed = readJsonFile(path.join(opsDir, name));
  const blockers = [];
  if (!parsed.ok) return artifact(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-operations-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifact(change, name, [`invalid-json-shape:${name}`]);
  const install = parsed.value;
  if (install.schema !== 'specnav.ops.installVerification.v1') blockers.push('invalid-install-verification:schema');
  for (const field of ['marketplace_root', 'plugin_root', 'plugin_name', 'plugin_source', 'target_project', 'command', 'host']) {
    if (!isCleanString(install[field])) blockers.push(`invalid-install-verification:${field}`);
  }
  if (install.ok !== true) blockers.push('install-verification-not-ok');
  if (install.discovery_root_checked !== true) blockers.push('install-verification-discovery-root');
  if (install.workspaceSupport !== 'available') blockers.push('install-verification-workspace-support');
  if (install.configStatus !== 'configured') blockers.push('install-verification-config-status');
  return artifact(change, name, blockers);
}

function validateUpdatePolicy(opsDir, change) {
  const name = 'update-policy.json';
  const parsed = readJsonFile(path.join(opsDir, name));
  const blockers = [];
  if (!parsed.ok) return artifact(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-operations-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifact(change, name, [`invalid-json-shape:${name}`]);
  const policy = parsed.value;
  if (policy.schema !== 'specnav.ops.updatePolicy.v1') blockers.push('invalid-update-policy:schema');
  if (policy.default_scope !== 'current-host') blockers.push('invalid-update-policy:default_scope');
  if (policy.all_hosts_requires_explicit_request !== true) blockers.push('invalid-update-policy:all_hosts_requires_explicit_request');
  if (!Array.isArray(policy.installations) || policy.installations.length === 0) blockers.push('invalid-update-policy:installations');
  return artifact(change, name, blockers);
}

function validateUpdateSpec(opsDir, change, hasSignoff) {
  const name = 'update-spec.json';
  const parsed = readJsonFile(path.join(opsDir, name));
  const blockers = [];
  if (!parsed.ok) return artifact(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-operations-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifact(change, name, [`invalid-json-shape:${name}`]);
  const update = parsed.value;
  if (update.schema !== 'specnav.ops.updateSpec.v1') blockers.push('invalid-update-spec:schema');
  if (update.change !== change) blockers.push('invalid-update-spec:change');
  if (!UPDATE_SPEC_STATUSES.has(update.status)) blockers.push('invalid-update-spec:status');
  if (!Array.isArray(update.learning_items)) blockers.push('invalid-update-spec:learning_items');
  if (!Array.isArray(update.unresolved_items)) blockers.push('invalid-update-spec:unresolved_items');
  else if (update.unresolved_items.length > 0) blockers.push('update-spec-unresolved-items');
  if (update.status === 'deferred' && !hasSignoff) blockers.push('update-spec-deferred-signoff');
  return artifact(change, name, blockers);
}

function readMigrationManifest(changeDir) {
  const parsed = readJsonFile(path.join(changeDir, 'development', 'migrations', 'manifest.json'));
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    return { required: false, ids: [], paths: [], blocker: 'missing-development-migrations-manifest' };
  }
  const migrations = Array.isArray(parsed.value.migrations) ? parsed.value.migrations : [];
  return {
    required: parsed.value.required === true,
    ids: migrations.map((entry) => entry && entry.id).filter(isCleanString),
    paths: migrations.map((entry) => entry && entry.path).filter(isCleanString),
    blocker: null
  };
}

function validateMigrationDeployment(opsDir, changeDir, change, target, readiness) {
  const manifest = readMigrationManifest(changeDir);
  const artifacts = [];
  const blockers = [];

  if (manifest.required && target !== 'project-deploy') blockers.push('migration-required-release-target');
  if (manifest.required && readiness && isPlainObject(readiness.ops) && readiness.ops.migrations !== 'pass') {
    blockers.push('readiness-migrations-not-pass');
  }

  if (!manifest.required) return { artifacts, blockers };

  const name = 'migration-deployment.json';
  const parsed = readJsonFile(path.join(opsDir, name));
  const deploymentBlockers = [];
  if (!parsed.ok) {
    deploymentBlockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-operations-artifact:${name}`);
  } else if (!isPlainObject(parsed.value)) {
    deploymentBlockers.push(`invalid-json-shape:${name}`);
  } else {
    const deployment = parsed.value;
    if (deployment.schema !== 'specnav.ops.migrationDeployment.v1') deploymentBlockers.push('invalid-migration-deployment:schema');
    if (deployment.change !== change) deploymentBlockers.push('invalid-migration-deployment:change');
    if (deployment.status !== 'pass') deploymentBlockers.push('migration-deployment-not-pass');
    if (deployment.source_manifest !== 'development/migrations/manifest.json') deploymentBlockers.push('invalid-migration-deployment:source_manifest');
    if (!cleanStringArray(deployment.applied_migrations)) deploymentBlockers.push('invalid-migration-deployment:applied_migrations');
    else {
      for (const id of manifest.ids) {
        if (!deployment.applied_migrations.includes(id)) deploymentBlockers.push(`migration-not-applied:${id}`);
      }
    }
    if (!cleanStringArray(deployment.evidence_refs)) deploymentBlockers.push('invalid-migration-deployment:evidence_refs');
    if (!cleanStringArray(deployment.rollback_refs) && !isCleanString(deployment.rollback_strategy)) {
      deploymentBlockers.push('invalid-migration-deployment:rollback');
    }
  }
  artifacts.push(artifact(change, name, deploymentBlockers));
  blockers.push(...deploymentBlockers);

  const deploy = readTextFile(path.join(opsDir, 'deploy-plan.md'));
  const rollback = readTextFile(path.join(opsDir, 'rollback-plan.md'));
  const planBlockers = [];
  if (!deploy.ok || !deploy.value.includes('development/migrations/manifest.json')) {
    planBlockers.push('deploy-plan-missing-migration-manifest');
  }
  if (!rollback.ok || !rollback.value.toLowerCase().includes('migration')) {
    planBlockers.push('rollback-plan-missing-migration-rollback');
  }
  artifacts.push(artifact(change, 'migration-plan-references', planBlockers));
  blockers.push(...planBlockers);

  return { artifacts, blockers: unique(blockers) };
}

function targetRequiredArtifacts(target) {
  const required = new Set(['readiness.md', 'readiness.json', 'release-plan.md', 'release-checklist.json', 'branch-finish.md', 'changelog.md', 'release-notes.md', 'update-spec.json']);
  if (target === 'plugin-marketplace' || target === 'host-compatibility') {
    required.add('install-verification.json');
    required.add('update-policy.json');
    required.add('compatibility-matrix.md');
  }
  if (target === 'project-deploy') {
    required.add('deploy-plan.md');
    required.add('rollback-plan.md');
    required.add('monitor-plan.md');
  }
  return required;
}

function validateOperations(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const changeState = lib.activeChangeState(projectRoot);
  const change = changeState.change;
  const changeDir = change ? lib.changeDir(projectRoot, change) : null;
  const opsDir = changeDir ? path.join(changeDir, 'operations') : null;
  const artifacts = [];
  const blockers = [];
  const warnings = [];

  if (!change || !changeDir || !fs.existsSync(changeDir)) {
    blockers.push(...(changeState.blockers && changeState.blockers.length ? changeState.blockers : ['active-change']));
  }
  if (!opsDir) {
    return {
      ok: false,
      project_root: projectRoot,
      active_change: change || null,
      change_resolution: {
        source: changeState.source,
        candidates: changeState.candidates || [],
        blockers: changeState.blockers || []
      },
      change_dir: changeDir,
      operations_dir: opsDir,
      release_target: null,
      blockers: unique(blockers),
      warnings: unique(warnings),
      codegraph: null,
      artifacts
    };
  }

  const signoff = fs.existsSync(path.join(opsDir, 'signoff.yaml')) || fs.existsSync(path.join(changeDir, 'signoff.yaml'));
  const risk = lib.readJson(path.join(changeDir, 'risk-tier.json'), { tier: 'standard' });
  const verification = validateVerification(changeDir, change, signoff);
  artifacts.push(...verification.artifacts);
  blockers.push(...verification.blockers);
  if (risk.tier === 'high-risk' && !signoff) blockers.push('high-risk-signoff');

  artifacts.push(validateTasksMarkdown(changeDir, change));
  artifacts.push(validateText(opsDir, change, 'readiness.md', ['Operations Scope', 'Readiness Decision', 'Evidence']));
  const readinessResult = validateReadiness(opsDir, change, verification.blockers);
  artifacts.push(readinessResult.artifact);
  const readiness = readinessResult.readiness;
  const target = readiness && TARGETS.has(readiness.release_target) ? readiness.release_target : null;
  const migrationDeployment = validateMigrationDeployment(opsDir, changeDir, change, target, readiness);
  artifacts.push(...migrationDeployment.artifacts);
  blockers.push(...migrationDeployment.blockers);

  artifacts.push(validateText(opsDir, change, 'release-plan.md', ['Release Target', 'Required Artifacts', 'Release Decision']));
  if (target) artifacts.push(validateReleaseChecklist(opsDir, change, target));
  artifacts.push(validateText(opsDir, change, 'branch-finish.md', ['Branch State', 'Finish Action', 'Cleanup Decision', 'Provenance']));
  const userFacing = !!(readiness && isPlainObject(readiness.docs) && readiness.docs.user_facing !== false);
  if (userFacing) artifacts.push(validateRequiredText(opsDir, change, 'changelog.md'));
  if (userFacing || target === 'package') artifacts.push(validateRequiredText(opsDir, change, 'release-notes.md'));
  artifacts.push(validateUpdateSpec(opsDir, change, signoff));

  if (target) {
    const required = targetRequiredArtifacts(target);
    if (required.has('install-verification.json')) artifacts.push(validateInstallVerification(opsDir, change));
    if (required.has('update-policy.json')) artifacts.push(validateUpdatePolicy(opsDir, change));
    if (required.has('compatibility-matrix.md')) {
      artifacts.push(validateText(opsDir, change, 'compatibility-matrix.md', ['Supported Hosts', 'Verification Command', 'Doctor Result', 'Known Limitations', 'Reload Requirement']));
    }
    if (required.has('deploy-plan.md')) {
      artifacts.push(validateText(opsDir, change, 'deploy-plan.md', ['Environment', 'Command', 'Smoke Checks', 'Owner']));
      artifacts.push(validateText(opsDir, change, 'rollback-plan.md', ['Triggers', 'Rollback Command', 'Verification']));
      artifacts.push(validateText(opsDir, change, 'monitor-plan.md', ['Signals', 'Observation Window', 'Escalation']));
      if (readiness && isPlainObject(readiness.ops)) {
        for (const [field, blocker] of [
          ['rollback_plan', 'project-deploy-rollback-plan'],
          ['monitor_plan', 'project-deploy-monitor-plan']
        ]) {
          if (readiness.ops[field] !== 'pass') blockers.push(blocker);
        }
      }
    }
  }

  if (target === 'package' && readiness && isPlainObject(readiness.ops)) {
    if (readiness.ops.package_validation !== 'pass') blockers.push('package-validation');
    if (readiness.ops.checksum_supported === true && !isCleanString(readiness.ops.checksum)) blockers.push('package-checksum');
  }

  if (readiness && isPlainObject(readiness.ops) && readiness.ops.postmortem_required === true) {
    artifacts.push(validateText(opsDir, change, 'postmortem.md', ['Trigger', 'Root Cause', 'Follow-up']));
  }

  blockers.push(...artifacts.flatMap((item) => item.blockers));
  const codegraph = codegraphStageGuard(projectRoot, change, 'operations');
  blockers.push(...codegraphBlockers(codegraph));
  warnings.push(...codegraphWarnings(codegraph));

  return {
    ok: blockers.length === 0,
    project_root: projectRoot,
    active_change: change || null,
    change_resolution: {
      source: changeState.source,
      candidates: changeState.candidates || [],
      blockers: changeState.blockers || []
    },
    change_dir: changeDir,
    operations_dir: opsDir,
    release_target: target,
    risk_tier: risk.tier || 'standard',
    blockers: unique(blockers),
    warnings: unique(warnings),
    codegraph,
    artifacts
  };
}

function writeArchiveGate(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const validation = validateOperations(projectRoot);
  const verdict = validation.ok ? 'green' : 'red';
  const report = {
    schema: 'specnav.ops.archiveGate.v1',
    generated_at: new Date().toISOString(),
    active_change: validation.active_change,
    release_target: validation.release_target,
    verdict,
    blockers: validation.blockers,
    warnings: validation.warnings || [],
    codegraph: validation.codegraph || null,
    operations_ready: validation.ok
  };

  if (validation.operations_dir) {
    lib.writeJson(path.join(validation.operations_dir, 'archive-gate.json'), report);
    const entry = {
      ts: report.generated_at,
      type: 'archive-gate',
      active_change: report.active_change,
      verdict,
      blockers: report.blockers
    };
    fs.appendFileSync(path.join(validation.operations_dir, 'archive-log.jsonl'), `${JSON.stringify(entry)}\n`);
    lib.event(projectRoot, 'operations.archive-gate', { active_change: report.active_change, verdict });
  }

  return report;
}

function markdown(result) {
  const lines = [];
  lines.push('# SpecNav Operations Gate');
  lines.push('');
  lines.push(`- project: \`${result.project_root}\``);
  lines.push(`- active change: \`${result.active_change || 'none'}\``);
  lines.push(`- release target: \`${result.release_target || 'none'}\``);
  lines.push(`- ok: ${result.ok}`);
  if (result.blockers && result.blockers.length) lines.push(`- blockers: ${result.blockers.join(', ')}`);
  if (Array.isArray(result.warnings) && result.warnings.length) lines.push(`- warnings: ${result.warnings.join(', ')}`);
  if (Array.isArray(result.artifacts)) {
    lines.push('');
    lines.push('| Artifact | Status | Blockers |');
    lines.push('| --- | --- | --- |');
    result.artifacts.forEach((item) => {
      lines.push(`| ${item.name} | ${item.ok ? 'pass' : 'blocked'} | ${item.blockers.join('<br>') || '-'} |`);
    });
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const result = validateOperations();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(markdown(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { validateOperations, writeArchiveGate, TARGETS };
