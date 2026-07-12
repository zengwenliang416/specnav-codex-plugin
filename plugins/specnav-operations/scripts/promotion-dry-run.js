#!/usr/bin/env node
'use strict';

// Dry-run admission for an Act->capability promoted check. Given a candidate id
// from operations/update-spec.json, this:
//   1. resolves the candidate rule file (candidate_artifact),
//   2. validates the rule shape,
//   3. lints the statement/globs for one-off tokens (the "prune UID -> business
//      variable" step) and reports whether it is generalized,
//   4. runs the rule read-only against the current repo (counts matching files),
//   5. writes operations/promotion/<id>/dry-run.json and emits promotion events.
//
// It is strictly non-blocking: it never mutates guard config and always exits 0.
// The pass/fail verdict lives in the report; admission stays a human decision.

const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

const RULE_SCHEMA = 'specnav.knowledge.promotedCheck.v1';
const RULE_VERIFY_VIA = new Set(['guard', 'fixture', 'static']);
const RULE_ENFORCEMENT = new Set(['advisory', 'gate']);

// One-off token shapes that must be generalized out of a promotable statement.
const ONE_OFF_PATTERNS = [
  /\b[0-9a-f]{8,}\b/i,                                   // long hex / hashes
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // uuid
  /\b\d{6,}\b/,                                          // long digit runs (ids)
  /\b(?:uid|user_id|order_id|session|session_id|trace_id)[=:\s]*[\w-]+/i
];

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

function isCleanString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function findOneOffTokens(text) {
  const hits = [];
  for (const pattern of ONE_OFF_PATTERNS) {
    const match = String(text || '').match(pattern);
    // A placeholder like <order-id> or {orderId} is already a business variable.
    if (match && !/[<{]/.test(String(text))) hits.push(match[0]);
  }
  return Array.from(new Set(hits));
}

function readCandidate(projectRoot, change, id) {
  const changeDir = lib.changeDir(projectRoot, change);
  const updateSpec = lib.readJson(path.join(changeDir, 'operations', 'update-spec.json'), null);
  const checks = updateSpec && Array.isArray(updateSpec.promoted_checks) ? updateSpec.promoted_checks : [];
  return checks.find((check) => check && check.id === id) || null;
}

function validateRule(rule) {
  const findings = [];
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return ['rule-not-object'];
  if (rule.schema !== RULE_SCHEMA) findings.push('rule-schema');
  if (!isCleanString(rule.id)) findings.push('rule-id');
  if (!isCleanString(rule.statement)) findings.push('rule-statement');
  if (!RULE_VERIFY_VIA.has(rule.verify_via)) findings.push('rule-verify_via');
  if (!RULE_ENFORCEMENT.has(rule.enforcement)) findings.push('rule-enforcement');
  if (!Array.isArray(rule.deny_globs) || rule.deny_globs.length === 0 || !rule.deny_globs.every(isCleanString)) {
    findings.push('rule-deny_globs');
  }
  return findings;
}

function trackedFiles(projectRoot) {
  const out = lib.runCommand('git ls-files', { cwd: projectRoot, timeoutMs: 30000 });
  if (!out.ok) return [];
  return out.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
    } else {
      out += escapeRegExp(c);
    }
  }
  return new RegExp(`${out}$`);
}

function dryRun(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const id = argValue('--id');
  const change = lib.activeChange(projectRoot);
  const findings = [];

  if (!isCleanString(id)) {
    return { schema: 'specnav.ops.promotionDryRun.v1', id: null, change, result: 'fail', generalized: false, findings: ['missing-id-argument'] };
  }

  const candidate = readCandidate(projectRoot, change, id);
  const ruleRel = argValue('--rule') || (candidate && candidate.candidate_artifact) || null;
  if (!isCleanString(ruleRel)) findings.push('missing-candidate-artifact');

  let rule = null;
  if (isCleanString(ruleRel)) {
    rule = lib.readJson(path.join(projectRoot, ruleRel), null);
    if (!rule) findings.push('unreadable-rule');
    else findings.push(...validateRule(rule));
  }

  const statement = (candidate && candidate.statement) || (rule && rule.statement) || '';
  const oneOff = findOneOffTokens(statement);
  const globOneOff = rule && Array.isArray(rule.deny_globs) ? rule.deny_globs.flatMap((g) => findOneOffTokens(g)) : [];
  const generalized = oneOff.length === 0 && globOneOff.length === 0;
  if (!generalized) findings.push(`not-generalized:${[...oneOff, ...globOneOff].join(',')}`);

  let matchingFiles = 0;
  if (rule && Array.isArray(rule.deny_globs)) {
    const regexes = rule.deny_globs.filter(isCleanString).map(globToRegExp);
    matchingFiles = trackedFiles(projectRoot).filter((file) => regexes.some((re) => re.test(file))).length;
  }

  const result = findings.length === 0 ? 'pass' : 'fail';
  return {
    schema: 'specnav.ops.promotionDryRun.v1',
    id,
    change,
    ran_at: new Date().toISOString(),
    verify_via: (rule && rule.verify_via) || (candidate && candidate.verify_via) || null,
    enforcement: rule && rule.enforcement ? rule.enforcement : null,
    generalized,
    matching_files: matchingFiles,
    result,
    findings
  };
}

function write(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const report = dryRun(projectRoot);
  if (report.change && report.id) {
    const changeDir = lib.changeDir(projectRoot, report.change);
    lib.writeJson(path.join(changeDir, 'operations', 'promotion', report.id, 'dry-run.json'), report);
    lib.event(projectRoot, 'promotion.candidate', { id: report.id, change: report.change });
    lib.event(projectRoot, 'promotion.dry-run', { id: report.id, change: report.change, result: report.result, generalized: report.generalized });
  }
  return report;
}

function markdown(report) {
  return [
    '# SpecNav Promotion Dry Run',
    '',
    `- id: \`${report.id || 'none'}\``,
    `- change: \`${report.change || 'none'}\``,
    `- generalized: ${report.generalized}`,
    `- matching files: ${report.matching_files || 0}`,
    `- result: ${report.result}`,
    report.findings.length ? `- findings: ${report.findings.join(', ')}` : '- findings: -',
    ''
  ].join('\n');
}

function main() {
  const report = process.argv.includes('--no-write') ? dryRun() : write();
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : markdown(report));
  // Dry-run is advisory: exit 0 regardless of pass/fail so it never gates.
  process.exit(0);
}

if (require.main === module) main();

module.exports = { dryRun, write, markdown, findOneOffTokens, validateRule, RULE_SCHEMA };
