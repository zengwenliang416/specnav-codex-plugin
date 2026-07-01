#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const { validateDevelopment } = runtime.requirePluginScript('specnav-development', 'scripts/development-contract');
const { guard: validateCodeGraph } = runtime.requirePluginScript('specnav-codegraph', 'scripts/codegraph-contract');

const DOMAINS = ['facticity', 'static', 'unit', 'redteam', 'e2e', 'sensory'];
const VERDICTS = new Set(['green', 'red', 'blocked']);
const BLOCKER_CLASSES = new Set([
  'tool-unavailable',
  'env-auth',
  'env-runtime',
  'contract-regression',
  'insufficient-evidence',
  'product-ambiguity',
  'scope-drift'
]);
const DOMAIN_REPORT_HEADINGS = [
  'Domain',
  'Verdict',
  'Inputs Reviewed',
  'Evidence',
  'Commands Run',
  'Findings',
  'Required Fixes',
  'Residual Risk',
  'Follow-up Domain Routing'
];
const INDEPENDENCE_HEADINGS = [
  'Inputs Allowed',
  'Inputs Excluded',
  'Controller Claims Ignored',
  'Files Reviewed',
  'Evidence References',
  'Cannot Verify From Provided Evidence'
];
const USER_TEST_CASE_HEADINGS = [
  'User Test Case Scope',
  'Aligned Test Cases',
  'User Signoff',
  'Domain Mapping'
];
const RUNTIME_SURFACES = ['runtime', 'browser'];

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
    if (error && error.code === 'ENOENT') return { ok: false, value: null, status: 'missing' };
    return { ok: false, value: null, status: 'unreadable' };
  }
}

function artifactPath(change, name) {
  return path.join('openspec', 'changes', change, 'verify', name);
}

function artifactResult(change, name, blockers, extra = {}) {
  return {
    name,
    path: artifactPath(change, name),
    ok: blockers.length === 0,
    blockers: unique(blockers),
    ...extra
  };
}

function parseJsonl(file, name, allowEmpty = false) {
  const text = readTextFile(file);
  const blockers = [];
  const entries = [];

  if (!text.ok) return { blockers: [`missing-verify-artifact:${name}`], entries };

  const lines = text.value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (!isPlainObject(entry)) blockers.push(`invalid-jsonl-shape:${name}:${index + 1}`);
      else entries.push(entry);
    } catch {
      blockers.push(`invalid-jsonl:${name}:${index + 1}`);
    }
  }

  if (!allowEmpty && entries.length === 0 && blockers.length === 0) blockers.push(`empty-jsonl:${name}`);
  return { blockers, entries };
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

function validateTextHeadings(verifyDir, change, name, headings, prefix) {
  const text = readTextFile(path.join(verifyDir, name));
  const blockers = [];
  if (!text.ok) return artifactResult(change, name, [`missing-verify-artifact:${name}`]);
  if (text.value.trim() === '') blockers.push(`empty-verify-artifact:${name}`);
  for (const heading of headings) {
    if (!hasHeading(text.value, heading)) blockers.push(`${prefix}:missing-heading:${heading}`);
  }
  return artifactResult(change, name, blockers);
}

function validatePlan(verifyDir, change) {
  const name = 'plan.json';
  const parsed = readJsonFile(path.join(verifyDir, name));
  const blockers = [];

  if (!parsed.ok) return artifactResult(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-verify-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifactResult(change, name, [`invalid-json-shape:${name}`]);

  const plan = parsed.value;
  if (plan.schema_version !== 1) blockers.push('invalid-verify-plan:schema_version');
  if (plan.change_id !== change) blockers.push('invalid-verify-plan:change_id');
  if (!isCleanString(plan.risk_tier)) blockers.push('invalid-verify-plan:risk_tier');
  if (!Array.isArray(plan.required_domains)) blockers.push('invalid-verify-plan:required_domains');
  else {
    for (const domain of DOMAINS) {
      if (!plan.required_domains.includes(domain)) blockers.push(`verify-plan:missing-domain:${domain}`);
    }
  }
  for (const field of ['inputs', 'changed_files', 'commands', 'manual_reviews']) {
    if (!Array.isArray(plan[field])) blockers.push(`invalid-verify-plan:${field}`);
  }
  if (Array.isArray(plan.changed_files)) {
    if (plan.changed_files.length === 0) blockers.push('invalid-verify-plan:changed_files-empty');
    if (plan.changed_files.some((item) => !isCleanString(item))) blockers.push('invalid-verify-plan:changed_files');
  }
  const gate = plan.user_test_case_gate;
  if (!isPlainObject(gate)) {
    blockers.push('invalid-verify-plan:user_test_case_gate');
  } else {
    const expectedGate = {
      cases: 'verify/user-test-cases.json',
      signoff: 'verify/user-test-case-signoff.json',
      domain_matrix: 'verify/domain-case-matrix.json'
    };
    if (gate.required !== true) blockers.push('invalid-verify-plan:user_test_case_gate.required');
    for (const [field, expected] of Object.entries(expectedGate)) {
      if (gate[field] !== expected) blockers.push(`invalid-verify-plan:user_test_case_gate.${field}`);
    }
  }
  const runtimeGate = plan.runtime_evidence_gate;
  if (!isPlainObject(runtimeGate)) {
    blockers.push('invalid-verify-plan:runtime_evidence_gate');
  } else {
    if (runtimeGate.required !== true) blockers.push('invalid-verify-plan:runtime_evidence_gate.required');
    if (runtimeGate.evidence !== 'verify/runtime-evidence.json') blockers.push('invalid-verify-plan:runtime_evidence_gate.evidence');
    if (!cleanStringArray(runtimeGate.required_surfaces)) blockers.push('invalid-verify-plan:runtime_evidence_gate.required_surfaces');
    else {
      for (const surface of RUNTIME_SURFACES) {
        if (!runtimeGate.required_surfaces.includes(surface)) blockers.push(`invalid-verify-plan:runtime_evidence_gate.missing:${surface}`);
      }
    }
  }

  return artifactResult(change, name, blockers, { required_domains: plan.required_domains || [] });
}

function validateEvidenceIndex(verifyDir, change) {
  const name = 'evidence-index.jsonl';
  const result = parseJsonl(path.join(verifyDir, name), name);
  const blockers = [...result.blockers];
  result.entries.forEach((entry, index) => {
    if (!isCleanString(entry.id)) blockers.push(`invalid-evidence-index:id:${index + 1}`);
    if (!isCleanString(entry.kind)) blockers.push(`invalid-evidence-index:kind:${index + 1}`);
    if (!isCleanString(entry.domain) || !DOMAINS.includes(entry.domain)) blockers.push(`invalid-evidence-index:domain:${index + 1}`);
  });
  return artifactResult(change, name, blockers, { entries: result.entries.length });
}

function validateTraceability(verifyDir, change) {
  const name = 'traceability-matrix.json';
  const parsed = readJsonFile(path.join(verifyDir, name));
  const blockers = [];
  if (!parsed.ok) return artifactResult(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-verify-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifactResult(change, name, [`invalid-json-shape:${name}`]);

  const trace = parsed.value;
  if (trace.schema_version !== 1) blockers.push('invalid-traceability:schema_version');
  if (trace.change_id !== change) blockers.push('invalid-traceability:change_id');
  if (!Array.isArray(trace.entries) || trace.entries.length === 0) blockers.push('invalid-traceability:entries');
  if (!Array.isArray(trace.unmapped_changes)) blockers.push('invalid-traceability:unmapped_changes');
  else if (trace.unmapped_changes.length > 0) blockers.push('traceability-unmapped-changes');
  if (Array.isArray(trace.entries)) {
    trace.entries.forEach((entry, index) => {
      if (!isPlainObject(entry) || !isCleanString(entry.changed_file)) blockers.push(`invalid-traceability-entry:changed_file:${index + 1}`);
      for (const field of ['requirement_refs', 'task_refs', 'prototype_refs', 'foundation_spec_refs', 'verification_domains']) {
        if (!Array.isArray(entry && entry[field]) || entry[field].length === 0) blockers.push(`invalid-traceability-entry:${field}:${index + 1}`);
      }
    });
  }
  return artifactResult(change, name, blockers);
}

function isResolvedUserString(value) {
  return isCleanString(value) && !value.includes('<decision-required>');
}

function resolvedStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isResolvedUserString(item));
}

function validateUserTestCaseGate(verifyDir, change) {
  const artifacts = [];
  const casesName = 'user-test-cases.json';
  const signoffName = 'user-test-case-signoff.json';
  const matrixName = 'domain-case-matrix.json';
  const casesParsed = readJsonFile(path.join(verifyDir, casesName));
  const signoffParsed = readJsonFile(path.join(verifyDir, signoffName));
  const matrixParsed = readJsonFile(path.join(verifyDir, matrixName));
  const caseBlockers = [];
  const signoffBlockers = [];
  const matrixBlockers = [];
  const caseIds = [];
  const approvedCaseIds = [];

  artifacts.push(validateTextHeadings(verifyDir, change, 'user-test-cases.md', USER_TEST_CASE_HEADINGS, 'invalid-user-test-cases-md'));

  if (!casesParsed.ok) {
    caseBlockers.push(casesParsed.status === 'invalid-json' ? `invalid-json:${casesName}` : `missing-verify-artifact:${casesName}`);
  } else if (!isPlainObject(casesParsed.value)) {
    caseBlockers.push(`invalid-json-shape:${casesName}`);
  } else {
    const data = casesParsed.value;
    if (data.schema_version !== 1) caseBlockers.push('invalid-user-test-cases:schema_version');
    if (data.change_id !== change) caseBlockers.push('invalid-user-test-cases:change_id');
    if (!Array.isArray(data.cases) || data.cases.length === 0) {
      caseBlockers.push('verify:user-test-cases-missing');
    } else {
      data.cases.forEach((item, index) => {
        if (!isPlainObject(item)) {
          caseBlockers.push(`invalid-user-test-case:shape:${index + 1}`);
          return;
        }
        if (!isResolvedUserString(item.id)) caseBlockers.push(`invalid-user-test-case:id:${index + 1}`);
        else caseIds.push(item.id);
        for (const field of ['title', 'actor', 'user_goal']) {
          if (!isResolvedUserString(item[field])) caseBlockers.push(`invalid-user-test-case:${field}:${item.id || index + 1}`);
        }
        for (const field of ['preconditions', 'steps', 'expected_results', 'acceptance_refs', 'source_refs']) {
          if (!resolvedStringArray(item[field])) caseBlockers.push(`invalid-user-test-case:${field}:${item.id || index + 1}`);
        }
      });
    }
  }
  const duplicateCaseIds = caseIds.filter((id, index) => caseIds.indexOf(id) !== index);
  if (duplicateCaseIds.length > 0) caseBlockers.push('invalid-user-test-cases:duplicate-ids');
  artifacts.push(artifactResult(change, casesName, caseBlockers, { case_ids: unique(caseIds) }));

  if (!signoffParsed.ok) {
    signoffBlockers.push(signoffParsed.status === 'invalid-json' ? `invalid-json:${signoffName}` : `missing-verify-artifact:${signoffName}`);
  } else if (!isPlainObject(signoffParsed.value)) {
    signoffBlockers.push(`invalid-json-shape:${signoffName}`);
  } else {
    const signoff = signoffParsed.value;
    if (signoff.schema_version !== 1) signoffBlockers.push('invalid-user-test-case-signoff:schema_version');
    if (signoff.change_id !== change) signoffBlockers.push('invalid-user-test-case-signoff:change_id');
    if (signoff.status !== 'approved') signoffBlockers.push('verify:user-test-cases-unapproved');
    if (!isResolvedUserString(signoff.user_decision)) signoffBlockers.push('invalid-user-test-case-signoff:user_decision');
    if (!resolvedStringArray(signoff.approved_case_ids)) {
      signoffBlockers.push('invalid-user-test-case-signoff:approved_case_ids');
    } else {
      approvedCaseIds.push(...signoff.approved_case_ids);
      for (const id of signoff.approved_case_ids) {
        if (!caseIds.includes(id)) signoffBlockers.push(`invalid-user-test-case-signoff:unknown-case:${id}`);
      }
      for (const id of caseIds) {
        if (!signoff.approved_case_ids.includes(id)) signoffBlockers.push(`verify:user-test-case-not-approved:${id}`);
      }
    }
  }
  artifacts.push(artifactResult(change, signoffName, signoffBlockers, { approved_case_ids: unique(approvedCaseIds) }));

  if (!matrixParsed.ok) {
    matrixBlockers.push(matrixParsed.status === 'invalid-json' ? `invalid-json:${matrixName}` : `missing-verify-artifact:${matrixName}`);
  } else if (!isPlainObject(matrixParsed.value)) {
    matrixBlockers.push(`invalid-json-shape:${matrixName}`);
  } else {
    const matrix = matrixParsed.value;
    if (matrix.schema_version !== 1) matrixBlockers.push('invalid-domain-case-matrix:schema_version');
    if (matrix.change_id !== change) matrixBlockers.push('invalid-domain-case-matrix:change_id');
    if (!Array.isArray(matrix.cases) || matrix.cases.length === 0) {
      matrixBlockers.push('verify:domain-case-matrix-missing');
    } else {
      const matrixIds = [];
      matrix.cases.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
          matrixBlockers.push(`invalid-domain-case-matrix:case:${index + 1}`);
          return;
        }
        if (!isResolvedUserString(entry.case_id)) {
          matrixBlockers.push(`invalid-domain-case-matrix:case_id:${index + 1}`);
          return;
        }
        matrixIds.push(entry.case_id);
        if (!caseIds.includes(entry.case_id)) matrixBlockers.push(`invalid-domain-case-matrix:unknown-case:${entry.case_id}`);
        if (!isPlainObject(entry.domains)) {
          matrixBlockers.push(`invalid-domain-case-matrix:domains:${entry.case_id}`);
          return;
        }
        for (const domain of DOMAINS) {
          if (!resolvedStringArray(entry.domains[domain])) {
            matrixBlockers.push(`verify:domain-case-missing:${entry.case_id}:${domain}`);
          }
        }
      });
      for (const id of approvedCaseIds) {
        if (!matrixIds.includes(id)) matrixBlockers.push(`verify:domain-case-matrix-missing-case:${id}`);
      }
    }
  }
  artifacts.push(artifactResult(change, matrixName, matrixBlockers));

  return artifacts;
}

function migrationRequired(changeDir) {
  if (!changeDir) return false;
  const parsed = readJsonFile(path.join(changeDir, 'development', 'migrations', 'manifest.json'));
  return parsed.ok && isPlainObject(parsed.value) && parsed.value.required === true;
}

function validateDiffTraceability(verifyDir, change) {
  const name = 'diff-traceability';
  const blockers = [];
  const plan = readJsonFile(path.join(verifyDir, 'plan.json'));
  const trace = readJsonFile(path.join(verifyDir, 'traceability-matrix.json'));
  if (!plan.ok || !trace.ok || !isPlainObject(plan.value) || !isPlainObject(trace.value)) {
    return artifactResult(change, name, ['diff-traceability:missing-inputs']);
  }
  const changedFiles = Array.isArray(plan.value.changed_files) ? plan.value.changed_files : [];
  const traceEntries = Array.isArray(trace.value.entries) ? trace.value.entries : [];
  const tracedFiles = new Set(traceEntries.map((entry) => entry && entry.changed_file).filter(isCleanString));
  for (const file of changedFiles) {
    if (!tracedFiles.has(file)) blockers.push(`diff-traceability:unmapped:${file}`);
  }
  return artifactResult(change, name, blockers, { changed_files: changedFiles.length, traced_files: tracedFiles.size });
}

function validateRuntimeEvidence(verifyDir, change, databaseRequired) {
  const name = 'runtime-evidence.json';
  const parsed = readJsonFile(path.join(verifyDir, name));
  const blockers = [];
  const requiredSurfaces = new Set([...RUNTIME_SURFACES, ...(databaseRequired ? ['database'] : [])]);
  const seenSurfaces = new Set();

  if (!parsed.ok) {
    return artifactResult(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-verify-artifact:${name}`], { required_surfaces: Array.from(requiredSurfaces) });
  }
  if (!isPlainObject(parsed.value)) return artifactResult(change, name, [`invalid-json-shape:${name}`], { required_surfaces: Array.from(requiredSurfaces) });

  const evidence = parsed.value;
  if (evidence.schema_version !== 1) blockers.push('invalid-runtime-evidence:schema_version');
  if (evidence.change_id !== change) blockers.push('invalid-runtime-evidence:change_id');
  if (evidence.status !== 'green') blockers.push('runtime-evidence-not-green');
  if (!Array.isArray(evidence.surfaces) || evidence.surfaces.length === 0) {
    blockers.push('invalid-runtime-evidence:surfaces');
  } else {
    evidence.surfaces.forEach((surface, index) => {
      if (!isPlainObject(surface)) {
        blockers.push(`invalid-runtime-evidence:surface:${index + 1}`);
        return;
      }
      if (!isCleanString(surface.surface)) {
        blockers.push(`invalid-runtime-evidence:surface-name:${index + 1}`);
        return;
      }
      seenSurfaces.add(surface.surface);
      if (surface.required !== true) blockers.push(`runtime-evidence-surface-not-required:${surface.surface}`);
      if (surface.status !== 'pass') blockers.push(`runtime-evidence-surface-not-pass:${surface.surface}`);
      if (!isCleanString(surface.command)) blockers.push(`invalid-runtime-evidence:command:${surface.surface}`);
      if (!cleanStringArray(surface.evidence_refs)) blockers.push(`invalid-runtime-evidence:evidence_refs:${surface.surface}`);
      const browserRefs = [
        ...(Array.isArray(surface.artifact_refs) ? surface.artifact_refs : []),
        ...(Array.isArray(surface.screenshot_refs) ? surface.screenshot_refs : [])
      ];
      const databaseRefs = [
        ...(Array.isArray(surface.query_refs) ? surface.query_refs : []),
        ...(Array.isArray(surface.artifact_refs) ? surface.artifact_refs : [])
      ];
      if (surface.surface === 'browser' && !cleanStringArray(browserRefs)) {
        blockers.push('invalid-runtime-evidence:browser-artifact_refs');
      }
      if (surface.surface === 'database' && !cleanStringArray(databaseRefs)) {
        blockers.push('invalid-runtime-evidence:database-query_refs');
      }
    });
  }
  for (const surface of requiredSurfaces) {
    if (!seenSurfaces.has(surface)) blockers.push(`runtime-evidence-missing-surface:${surface}`);
  }
  return artifactResult(change, name, blockers, { required_surfaces: Array.from(requiredSurfaces), surfaces: Array.from(seenSurfaces) });
}

function validateBlockers(verifyDir, change) {
  const name = 'blocker-classification.jsonl';
  const result = parseJsonl(path.join(verifyDir, name), name, true);
  const blockers = [...result.blockers];
  result.entries.forEach((entry, index) => {
    if (!isCleanString(entry.domain) || !DOMAINS.includes(entry.domain)) blockers.push(`invalid-blocker-classification:domain:${index + 1}`);
    if (!isCleanString(entry.blocker_class) || !BLOCKER_CLASSES.has(entry.blocker_class)) blockers.push(`invalid-blocker-classification:blocker_class:${index + 1}`);
    if (entry.status === 'unresolved') blockers.push(`unresolved-verification-blocker:${entry.domain || index + 1}`);
  });
  return artifactResult(change, name, blockers, { entries: result.entries.length });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function listItems(values, empty = 'None') {
  if (!Array.isArray(values) || values.length === 0) return `<li>${escapeHtml(empty)}</li>`;
  return values.map((value) => `<li>${escapeHtml(value)}</li>`).join('');
}

function artifactRows(artifacts) {
  return artifacts.map((artifact) => {
    const status = artifact.ok ? 'pass' : 'blocked';
    const blockers = artifact.blockers && artifact.blockers.length ? artifact.blockers.join(', ') : '-';
    return [
      '<tr>',
      `<td><code>${escapeHtml(artifact.name)}</code></td>`,
      `<td><span class="status ${status}">${escapeHtml(status)}</span></td>`,
      `<td>${escapeHtml(blockers)}</td>`,
      '</tr>'
    ].join('');
  }).join('\n');
}

function domainCards(report) {
  return DOMAINS.map((domain) => {
    const verdict = report.domains && report.domains[domain] ? report.domains[domain] : 'blocked';
    return [
      `<article class="domain-card ${escapeHtml(verdict)}">`,
      `<p class="eyebrow">${escapeHtml(domain)}</p>`,
      `<h3>${escapeHtml(verdict)}</h3>`,
      `<p>Evidence file: <code>verify/${escapeHtml(domain)}/report.json</code></p>`,
      '</article>'
    ].join('');
  }).join('\n');
}

function codegraphSummary(report) {
  const codegraph = report && report.codegraph;
  if (!codegraph || !codegraph.decision) {
    return [
      '<div class="meta"><strong>CodeGraph</strong>not evaluated</div>',
      '<div class="meta"><strong>Evidence</strong>no evidence index</div>',
      '<div class="meta"><strong>Artifacts</strong>none</div>'
    ].join('\n');
  }
  const decision = codegraph.decision || {};
  const index = codegraph.evidence_index || {};
  const artifacts = codegraph.artifacts || {};
  const blockers = Array.isArray(codegraph.blockers) ? codegraph.blockers.length : 0;
  const warnings = Array.isArray(codegraph.warnings) ? codegraph.warnings.length : 0;
  return [
    `<div class="meta"><strong>CodeGraph</strong>${escapeHtml(decision.result || 'unknown')} · ${escapeHtml(decision.effective_mode || 'unknown')}</div>`,
    `<div class="meta"><strong>Evidence</strong>${Number(index.record_count || 0)} records · ${index.raw_exists ? 'raw present' : 'raw missing'}</div>`,
    `<div class="meta"><strong>Artifacts</strong><code>${escapeHtml(artifacts.guard_report || 'openspec/changes/.../codegraph/guard-report.json')}</code></div>`,
    `<div class="meta"><strong>Blockers</strong>${blockers}</div>`,
    `<div class="meta"><strong>Warnings</strong>${warnings}</div>`,
    `<div class="meta"><strong>Drift</strong><code>${escapeHtml(artifacts.drift_report || 'openspec/changes/.../codegraph/drift-report.json')}</code></div>`
  ].join('\n');
}

function renderAggregateHtml(report) {
  const verdict = report.verdict || 'red';
  const generated = report.generated_at || new Date().toISOString();
  const blocking = Array.isArray(report.blocking_findings) ? report.blocking_findings : [];
  const artifacts = Array.isArray(report.artifacts) ? report.artifacts : [];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SpecNav Verification Report</title>
  <style>
    :root {
      --canvas: #faf9f5;
      --surface-soft: #f5f0e8;
      --surface-card: #efe9de;
      --surface-dark: #181715;
      --surface-dark-elevated: #252320;
      --primary: #cc785c;
      --primary-active: #a9583e;
      --accent-teal: #5db8a6;
      --accent-amber: #e8a55a;
      --ink: #141413;
      --body: #3d3d3a;
      --muted: #6c6a64;
      --muted-soft: #8e8b82;
      --hairline: #e6dfd8;
      --on-dark: #faf9f5;
      --on-dark-soft: #a09d96;
      --error: #c64545;
      --success: #5db872;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--canvas);
      color: var(--body);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.55;
    }
    .page { max-width: 1200px; margin: 0 auto; padding: 64px 24px 80px; }
    .topline {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: center;
      margin-bottom: 64px;
    }
    .brand { display: flex; align-items: center; gap: 12px; color: var(--ink); font-weight: 600; }
    .mark {
      width: 20px;
      height: 20px;
      position: relative;
      display: inline-block;
    }
    .mark::before,
    .mark::after {
      content: "";
      position: absolute;
      inset: 9px 1px auto 1px;
      height: 2px;
      background: var(--ink);
      border-radius: 999px;
    }
    .mark::after { transform: rotate(90deg); }
    .badge {
      border-radius: 999px;
      background: var(--surface-card);
      color: var(--ink);
      border: 1px solid var(--hairline);
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 500;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
      gap: 32px;
      align-items: stretch;
      margin-bottom: 96px;
    }
    h1, h2, h3 {
      color: var(--ink);
      font-family: "Tiempos Headline", "Cormorant Garamond", Georgia, "Times New Roman", serif;
      font-weight: 400;
      letter-spacing: -0.02em;
      margin: 0;
    }
    h1 { font-size: clamp(44px, 7vw, 72px); line-height: 1.04; max-width: 760px; }
    h2 { font-size: clamp(30px, 4vw, 48px); line-height: 1.1; margin-bottom: 24px; }
    h3 { font-size: 28px; line-height: 1.2; }
    .lead { color: var(--body-strong, #252523); font-size: 18px; max-width: 680px; margin-top: 24px; }
    .eyebrow {
      margin: 0 0 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 12px;
      font-weight: 600;
    }
    .cta-card {
      background: var(--primary);
      color: white;
      border-radius: 12px;
      padding: 32px;
      min-height: 100%;
    }
    .cta-card h2, .cta-card p { color: white; }
    .cta-card code {
      background: rgba(255,255,255,0.16);
      color: white;
      padding: 2px 6px;
      border-radius: 6px;
    }
    .dark-panel {
      background: var(--surface-dark);
      color: var(--on-dark);
      border-radius: 12px;
      padding: 32px;
      margin-bottom: 96px;
    }
    .dark-panel h2 { color: var(--on-dark); }
    .domain-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .domain-card {
      background: var(--surface-dark-elevated);
      border: 1px solid rgba(250,249,245,0.08);
      border-radius: 12px;
      padding: 24px;
    }
    .domain-card h3 { color: var(--on-dark); }
    .domain-card p { color: var(--on-dark-soft); }
    .domain-card.green { border-color: rgba(93,184,114,0.5); }
    .domain-card.red, .domain-card.blocked { border-color: rgba(198,69,69,0.6); }
    .section {
      background: var(--surface-card);
      border-radius: 12px;
      padding: 32px;
      margin-bottom: 32px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .meta {
      background: var(--canvas);
      border: 1px solid var(--hairline);
      border-radius: 12px;
      padding: 20px;
    }
    .meta strong { display: block; color: var(--ink); margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; background: var(--canvas); border-radius: 12px; overflow: hidden; }
    th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
    th { color: var(--ink); font-size: 13px; font-weight: 600; background: var(--surface-soft); }
    code {
      font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
      color: var(--primary-active);
    }
    .status {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .status.pass, .status.green { background: rgba(93,184,114,0.14); color: #2d7f42; }
    .status.blocked, .status.red { background: rgba(198,69,69,0.12); color: var(--error); }
    ul { margin: 0; padding-left: 20px; }
    .footer {
      color: var(--muted-soft);
      font-size: 13px;
      padding-top: 32px;
    }
    @media (max-width: 820px) {
      .hero, .meta-grid, .domain-grid { grid-template-columns: 1fr; }
      .topline { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="page">
    <nav class="topline">
      <div class="brand"><span class="mark" aria-hidden="true"></span><span>SpecNav</span></div>
      <span class="badge">Six-domain verification</span>
    </nav>

    <section class="hero">
      <div>
        <p class="eyebrow">Verification report</p>
        <h1>Evidence-backed delivery review for ${escapeHtml(report.active_change || 'active change')}</h1>
        <p class="lead">This page summarizes the six verification domains, blocking findings, artifact coverage, and stakeholder-ready review status generated by SpecNav.</p>
      </div>
      <aside class="cta-card">
        <p class="eyebrow">Current verdict</p>
        <h2>${escapeHtml(verdict)}</h2>
        <p>Generated at <code>${escapeHtml(generated)}</code>.</p>
        <p>Machine report: <code>verify/aggregate-report.json</code></p>
      </aside>
    </section>

    <section class="dark-panel">
      <h2>Domain Results</h2>
      <div class="domain-grid">
        ${domainCards(report)}
      </div>
    </section>

    <section class="section">
      <h2>Review Summary</h2>
      <div class="meta-grid">
        <div class="meta"><strong>Change</strong>${escapeHtml(report.active_change || 'none')}</div>
        <div class="meta"><strong>Verdict</strong><span class="status ${escapeHtml(verdict)}">${escapeHtml(verdict)}</span></div>
        <div class="meta"><strong>Stale</strong>${report.stale ? 'yes' : 'no'}</div>
      </div>
    </section>

    <section class="section">
      <h2>Blocking Findings</h2>
      <ul>${listItems(blocking)}</ul>
    </section>

    <section class="section">
      <h2>CodeGraph Evidence</h2>
      <div class="meta-grid">
        ${codegraphSummary(report)}
      </div>
    </section>

    <section class="section">
      <h2>Artifact Coverage</h2>
      <table>
        <thead><tr><th>Artifact</th><th>Status</th><th>Blockers</th></tr></thead>
        <tbody>
          ${artifactRows(artifacts)}
        </tbody>
      </table>
    </section>

    <p class="footer">Claude warm editorial style: cream canvas, coral action surface, dark product panel, serif display headings, and humanist sans body.</p>
  </main>
</body>
</html>
`;
}

function validateReceipt(verifyDir, change) {
  const name = 'receipt.json';
  const parsed = readJsonFile(path.join(verifyDir, name));
  const blockers = [];
  if (!parsed.ok) return artifactResult(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-verify-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifactResult(change, name, [`invalid-json-shape:${name}`]);
  const receipt = parsed.value;
  if (receipt.schema_version !== 1) blockers.push('invalid-receipt:schema_version');
  if (receipt.change_id !== change) blockers.push('invalid-receipt:change_id');
  if (receipt.result !== 'green') blockers.push('invalid-receipt:result');
  for (const field of ['covered_scope', 'uncovered_scope', 'residual_risk']) {
    if (!Array.isArray(receipt[field])) blockers.push(`invalid-receipt:${field}`);
  }
  if (Array.isArray(receipt.covered_scope) && receipt.covered_scope.length === 0) blockers.push('invalid-receipt:covered_scope');
  if (Array.isArray(receipt.uncovered_scope) && receipt.uncovered_scope.length > 0) blockers.push('receipt-uncovered-scope');
  if (Array.isArray(receipt.residual_risk) && receipt.residual_risk.length > 0 && receipt.confidence === 'A') blockers.push('receipt-confidence-overclaim');
  if (!['A', 'B', 'C'].includes(receipt.confidence)) blockers.push('invalid-receipt:confidence');
  return artifactResult(change, name, blockers);
}

function validateDomainReport(verifyDir, change, domain) {
  const name = `${domain}/report.json`;
  const parsed = readJsonFile(path.join(verifyDir, name));
  const blockers = [];
  if (!parsed.ok) return artifactResult(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-verify-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifactResult(change, name, [`invalid-json-shape:${name}`]);

  const report = parsed.value;
  if (report.schema_version !== 1) blockers.push(`invalid-domain-report:${domain}:schema_version`);
  if (report.domain !== domain) blockers.push(`invalid-domain-report:${domain}:domain`);
  if (!VERDICTS.has(report.verdict)) blockers.push(`invalid-domain-report:${domain}:verdict`);
  if (report.required !== true) blockers.push(`invalid-domain-report:${domain}:required`);
  for (const field of ['evidence', 'commands', 'findings', 'required_fixes', 'residual_risk']) {
    if (!Array.isArray(report[field])) blockers.push(`invalid-domain-report:${domain}:${field}`);
  }
  if (report.verdict !== 'green') blockers.push(`${domain}-not-green`);
  if (Array.isArray(report.required_fixes) && report.required_fixes.length > 0) blockers.push(`${domain}-required-fixes`);
  if (report.blocker_class !== null && report.blocker_class !== undefined && !BLOCKER_CLASSES.has(report.blocker_class)) {
    blockers.push(`invalid-domain-report:${domain}:blocker_class`);
  }
  return artifactResult(change, name, blockers, { verdict: report.verdict || null });
}

function validateUnitRubric(verifyDir, change) {
  const name = 'unit/test-quality-rubric.json';
  const parsed = readJsonFile(path.join(verifyDir, name));
  const blockers = [];
  if (!parsed.ok) return artifactResult(change, name, [parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-verify-artifact:${name}`]);
  if (!isPlainObject(parsed.value)) return artifactResult(change, name, [`invalid-json-shape:${name}`]);
  const rubric = parsed.value;
  if (rubric.schema_version !== 1) blockers.push('invalid-test-quality-rubric:schema_version');
  if (!isPlainObject(rubric.checks)) blockers.push('invalid-test-quality-rubric:checks');
  else {
    for (const [key, value] of Object.entries(rubric.checks)) {
      if (value !== true) blockers.push(`unit-test-quality-blocking:${key}`);
    }
  }
  if (!Array.isArray(rubric.findings)) blockers.push('invalid-test-quality-rubric:findings');
  else if (rubric.findings.length > 0) blockers.push('unit-test-quality-findings');
  return artifactResult(change, name, blockers);
}

function validateBehaviorEvals(verifyDir, change) {
  const artifacts = [];
  const scenarios = readJsonFile(path.join(verifyDir, 'behavior-evals/scenarios.json'));
  const scenarioBlockers = [];
  const scenarioIds = [];
  if (!scenarios.ok) scenarioBlockers.push(scenarios.status === 'invalid-json' ? 'invalid-json:behavior-evals/scenarios.json' : 'missing-verify-artifact:behavior-evals/scenarios.json');
  else if (!isPlainObject(scenarios.value) || scenarios.value.schema_version !== 1 || !Array.isArray(scenarios.value.scenarios)) {
    scenarioBlockers.push('invalid-behavior-evals:scenarios');
  } else {
    scenarios.value.scenarios.forEach((scenario, index) => {
      if (!isPlainObject(scenario)) {
        scenarioBlockers.push(`invalid-behavior-evals:scenario:${index + 1}`);
        return;
      }
      if (!isCleanString(scenario.id)) scenarioBlockers.push(`invalid-behavior-evals:scenario-id:${index + 1}`);
      else scenarioIds.push(scenario.id);
      if (!isCleanString(scenario.prompt)) scenarioBlockers.push(`invalid-behavior-evals:scenario-prompt:${scenario.id || index + 1}`);
      if (!Array.isArray(scenario.expected) || scenario.expected.length === 0 || scenario.expected.some((item) => !isCleanString(item))) {
        scenarioBlockers.push(`invalid-behavior-evals:scenario-expected:${scenario.id || index + 1}`);
      }
    });
    if (scenarioIds.length === 0) scenarioBlockers.push('invalid-behavior-evals:no-scenarios');
  }
  artifacts.push(artifactResult(change, 'behavior-evals/scenarios.json', scenarioBlockers));

  const report = readJsonFile(path.join(verifyDir, 'behavior-evals/report.json'));
  const reportBlockers = [];
  if (!report.ok) reportBlockers.push(report.status === 'invalid-json' ? 'invalid-json:behavior-evals/report.json' : 'missing-verify-artifact:behavior-evals/report.json');
  else if (!isPlainObject(report.value) || report.value.schema_version !== 1 || report.value.status !== 'green') {
    reportBlockers.push('invalid-behavior-evals:report');
  } else {
    const covered = Array.isArray(report.value.scenarios) ? report.value.scenarios : [];
    if (covered.some((item) => !isCleanString(item))) reportBlockers.push('invalid-behavior-evals:report-scenarios');
    for (const id of scenarioIds) {
      if (!covered.includes(id)) reportBlockers.push(`behavior-eval-scenario-not-reported:${id}`);
    }
    if (Array.isArray(report.value.unresolved_blockers) && report.value.unresolved_blockers.length > 0) {
      reportBlockers.push('behavior-eval-unresolved-blockers');
    }
  }
  artifacts.push(artifactResult(change, 'behavior-evals/report.json', reportBlockers));
  const transcriptBlockers = [];
  const transcriptsDir = path.join(verifyDir, 'behavior-evals/transcripts');
  for (const id of scenarioIds) {
    const markdown = path.join(transcriptsDir, `${id}.md`);
    const json = path.join(transcriptsDir, `${id}.json`);
    const markdownText = readTextFile(markdown);
    const jsonText = readTextFile(json);
    const transcriptText = markdownText.ok ? markdownText.value : (jsonText.ok ? jsonText.value : '');
    if (transcriptText.trim() === '') {
      transcriptBlockers.push(`missing-behavior-eval-transcript:${id}`);
    } else if (/<decision-required>|\b(?:TODO|TBD)\b/i.test(transcriptText)) {
      transcriptBlockers.push(`placeholder-behavior-eval-transcript:${id}`);
    }
  }
  artifacts.push(artifactResult(change, 'behavior-evals/transcripts', transcriptBlockers));
  artifacts.push(validateTextHeadings(verifyDir, change, 'behavior-evals/report.md', ['Scenarios', 'Transcripts', 'Result'], 'invalid-behavior-evals-report'));
  return artifacts;
}

function staleMarkerUnresolved(changeDir, verifyDir) {
  if (!changeDir) return false;
  const staleFile = path.join(changeDir, 'verify-report.stale');
  if (!fs.existsSync(staleFile)) return false;
  let staleMtime;
  try {
    staleMtime = fs.statSync(staleFile).mtimeMs;
  } catch {
    return true;
  }
  if (!verifyDir) return true;
  for (const domain of DOMAINS) {
    let reportMtime;
    try {
      reportMtime = fs.statSync(path.join(verifyDir, domain, 'report.json')).mtimeMs;
    } catch {
      return true;
    }
    if (reportMtime <= staleMtime) return true;
  }
  return false;
}

function validateVerify(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const development = validateDevelopment(projectRoot, { mode: 'handoff' });
  const changeState = lib.activeChangeState(projectRoot);
  const change = development.active_change || changeState.change;
  const changeDir = change ? lib.changeDir(projectRoot, change) : null;
  const verifyDir = changeDir ? path.join(changeDir, 'verify') : null;
  const artifacts = [];
  const blockers = [];
  const warnings = [];

  if (!development.ok) blockers.push('development-blocked', ...development.blockers.map((blocker) => `development:${blocker}`));
  if (Array.isArray(development.warnings)) warnings.push(...development.warnings.map((warning) => `development:${warning}`));
  if (!change || !changeDir || !fs.existsSync(changeDir)) {
    blockers.push(...(changeState.blockers && changeState.blockers.length ? changeState.blockers : ['active-change']));
  }

  if (verifyDir) {
    artifacts.push(validateTextHeadings(verifyDir, change, 'plan.md', ['Verification Scope', 'Required Domains', 'Evidence Plan'], 'invalid-verify-plan-md'));
    artifacts.push(validatePlan(verifyDir, change));
    artifacts.push(validateEvidenceIndex(verifyDir, change));
    artifacts.push(validateTraceability(verifyDir, change));
    artifacts.push(validateDiffTraceability(verifyDir, change));
    artifacts.push(...validateUserTestCaseGate(verifyDir, change));
    artifacts.push(validateRuntimeEvidence(verifyDir, change, migrationRequired(changeDir)));
    artifacts.push(validateBlockers(verifyDir, change));
    artifacts.push(validateTextHeadings(verifyDir, change, 'receipt.md', ['Covered Scope', 'Uncovered Scope', 'Residual Risk', 'Confidence'], 'invalid-receipt-md'));
    artifacts.push(validateReceipt(verifyDir, change));
    artifacts.push(...validateBehaviorEvals(verifyDir, change));
    for (const domain of DOMAINS) {
      artifacts.push(validateTextHeadings(verifyDir, change, `${domain}/report.md`, DOMAIN_REPORT_HEADINGS, `invalid-domain-report-md:${domain}`));
      artifacts.push(validateDomainReport(verifyDir, change, domain));
    }
    artifacts.push(validateUnitRubric(verifyDir, change));
    artifacts.push(validateTextHeadings(verifyDir, change, 'sensory/reviewer-independence.md', INDEPENDENCE_HEADINGS, 'invalid-reviewer-independence'));
    artifacts.push(artifactResult(change, 'root-cause-checks.jsonl', parseJsonl(path.join(verifyDir, 'root-cause-checks.jsonl'), 'root-cause-checks.jsonl', true).blockers));
  }

  blockers.push(...artifacts.flatMap((artifact) => artifact.blockers));
  if (staleMarkerUnresolved(changeDir, verifyDir)) blockers.push('stale-verify-report');
  const codegraph = codegraphStageGuard(projectRoot, change, 'verification');
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
    verify_dir: verifyDir,
    blockers: unique(blockers),
    warnings: unique(warnings),
    codegraph,
    development,
    artifacts
  };
}

function writeAggregate(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const validation = validateVerify(projectRoot);
  const verifyDir = validation.verify_dir;
  const staleUnresolved = staleMarkerUnresolved(validation.change_dir, verifyDir);
  const verdict = validation.ok ? 'green' : 'red';
  const domains = {};
  for (const domain of DOMAINS) {
    const artifact = validation.artifacts.find((item) => item.name === `${domain}/report.json`);
    domains[domain] = artifact && VERDICTS.has(artifact.verdict) ? artifact.verdict : 'blocked';
  }
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    change_id: validation.active_change,
    active_change: validation.active_change,
    verdict,
    domains,
    blocking_findings: validation.blockers,
    residual_risk: [],
    evidence_receipt: 'verify/receipt.json',
    behavior_eval_report: 'verify/behavior-evals/report.json',
    html_report: 'verify/aggregate-report.html',
    review_style: 'claude-warm-editorial',
    stale: staleUnresolved,
    blockers: validation.blockers,
    warnings: validation.warnings || [],
    codegraph: validation.codegraph || null,
    required_domains: DOMAINS,
    artifacts: validation.artifacts.map((artifact) => ({
      name: artifact.name,
      path: artifact.path,
      ok: artifact.ok,
      blockers: artifact.blockers
    }))
  };

  if (verifyDir) {
    lib.writeJson(path.join(verifyDir, 'aggregate-report.json'), report);
    const lines = [
      '# SpecNav Aggregate Verification Report',
      '',
      `- active_change: ${report.active_change || 'none'}`,
      `- verdict: ${report.verdict}`,
      `- blockers: ${report.blockers.join(', ') || '-'}`,
      `- codegraph: ${report.codegraph && report.codegraph.decision ? report.codegraph.decision.result : 'not-evaluated'}`,
      `- codegraph artifacts: ${report.codegraph && report.codegraph.artifacts ? report.codegraph.artifacts.guard_report : '-'}`,
      '',
      '| Artifact | Status | Blockers |',
      '| --- | --- | --- |',
      ...report.artifacts.map((artifact) => `| ${artifact.name} | ${artifact.ok ? 'pass' : 'blocked'} | ${artifact.blockers.join('<br>') || '-'} |`)
    ];
    fs.writeFileSync(path.join(verifyDir, 'aggregate-report.md'), `${lines.join('\n')}\n`);
    fs.writeFileSync(path.join(verifyDir, 'aggregate-report.html'), renderAggregateHtml(report));
    lib.writeJson(path.join(validation.change_dir, 'verify-report.json'), {
      schema_version: 1,
      generated_at: report.generated_at,
      active_change: report.active_change,
      status: verdict,
      aggregate: report,
      html_report: 'verify-report.html',
      review_style: report.review_style
    });
    fs.writeFileSync(path.join(validation.change_dir, 'verify-report.md'), `${lines.join('\n')}\n`);
    fs.writeFileSync(path.join(validation.change_dir, 'verify-report.html'), renderAggregateHtml(report));
    if (verdict === 'green') {
      try {
        fs.unlinkSync(path.join(validation.change_dir, 'verify-report.stale'));
      } catch {}
    }
    lib.event(projectRoot, 'verify.aggregate', { active_change: report.active_change, verdict });
  }
  return report;
}

function markdown(result) {
  const lines = [];
  lines.push('# SpecNav Verification Domains');
  lines.push('');
  lines.push(`- project: \`${result.project_root}\``);
  lines.push(`- active change: \`${result.active_change || 'none'}\``);
  lines.push(`- verify dir: \`${result.verify_dir || 'none'}\``);
  lines.push(`- ok: ${result.ok}`);
  if (result.blockers.length) lines.push(`- blockers: ${result.blockers.join(', ')}`);
  if (Array.isArray(result.warnings) && result.warnings.length) lines.push(`- warnings: ${result.warnings.join(', ')}`);
  lines.push('');
  lines.push('| Artifact | Status | Blockers |');
  lines.push('| --- | --- | --- |');
  for (const artifact of result.artifacts) {
    lines.push(`| ${artifact.name} | ${artifact.ok ? 'pass' : 'blocked'} | ${artifact.blockers.join('<br>') || '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('--')) || 'validate';
  if (!['validate', 'aggregate'].includes(command)) {
    const result = {
      ok: false,
      project_root: path.resolve(lib.projectRoot()),
      active_change: null,
      change_dir: null,
      verify_dir: null,
      blockers: [`unknown-command:${command}`],
      warnings: [],
      codegraph: null,
      artifacts: []
    };
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : markdown(result));
    process.exit(2);
  }
  const result = command === 'aggregate' ? writeAggregate() : validateVerify();
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : (command === 'aggregate' ? `${JSON.stringify(result, null, 2)}\n` : markdown(result)));
  process.exit((result.ok === false || result.verdict === 'red') ? 2 : 0);
}

if (require.main === module) main();

module.exports = { DOMAINS, validateVerify, writeAggregate };
