#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');
const runtime = require('./plugin-runtime');

function detectTestCommand(root) {
  if (process.env.SPECNAV_TEST_COMMAND) return process.env.SPECNAV_TEST_COMMAND;
  const pkg = lib.readJson(path.join(root, 'package.json'), null);
  if (pkg && pkg.scripts && pkg.scripts.test) return 'npm test';
  return null;
}

function verify(root = lib.projectRoot()) {
  const change = lib.activeChange(root);
  const dir = lib.changeDir(root, change);
  const checks = [];
  const add = (name, status, detail = '') => checks.push({ name, status, detail });

  if (!change || !dir || !fs.existsSync(dir)) {
    add('active-change', 'fail', 'No active OpenSpec change found.');
  } else {
    add('active-change', 'pass', change);
  }

  for (const artifact of ['proposal.md', 'design.md', 'tasks.md']) {
    add(artifact, lib.fileExists(path.join(dir || '', artifact)) ? 'pass' : 'fail');
  }
  add('delta-specs', fs.existsSync(path.join(dir || '', 'specs')) ? 'pass' : 'warn', 'Expected openspec/changes/<change>/specs/.');

  const command = detectTestCommand(root);
  let testResult = null;
  if (command) {
    testResult = lib.runCommand(command, { cwd: root, timeoutMs: Number(process.env.SPECNAV_TEST_TIMEOUT_MS || 120000) });
    add('tests', testResult.ok ? 'pass' : 'fail', command);
  } else {
    add('tests', 'warn', 'No SPECNAV_TEST_COMMAND or package.json test script found.');
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const status = failed.length ? 'red' : 'green';
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_root: root,
    active_change: change,
    status,
    checks,
    test_command: command,
    test_result: testResult && {
      ok: testResult.ok,
      status: testResult.status,
      duration_ms: testResult.duration_ms,
      stdout_tail: testResult.stdout.slice(-4000),
      stderr_tail: testResult.stderr.slice(-4000)
    },
    rework: failed.map((check) => ({
      check: check.name,
      class: check.name === 'design.md' || check.name === 'delta-specs' ? 'design' : 'implementation',
      recommendation: `Fix ${check.name} and rerun verify.`
    }))
  };

  if (dir) {
    if (fs.existsSync(path.join(dir, 'verify'))) {
      try {
        const domains = runtime.requirePluginScript('specnav-verification', 'scripts/verify-domains');
        const aggregate = domains.writeAggregate(root);
        report.status = failed.length === 0 && aggregate.verdict === 'green' ? 'green' : 'red';
        report.aggregate = aggregate;
        report.rework.push(...aggregate.blockers.map((blocker) => ({
          check: 'six-domain-verification',
          class: 'verification',
          recommendation: `Resolve ${blocker} and rerun verify.`
        })));
      } catch {
        report.checks.push({ name: 'six-domain-verification', status: 'warn', detail: 'specnav-verification plugin not available' });
      }
    }
    lib.writeJson(path.join(dir, 'verify-report.json'), report);
    try {
      fs.unlinkSync(path.join(dir, 'verify-report.stale'));
    } catch {}
    fs.writeFileSync(path.join(dir, 'verify-report.md'), markdown(report));
    lib.event(root, 'verify', { active_change: change, status });
    const affordances = require('./affordances').buildAffordances(root);
    lib.writeJson(path.join(lib.specnavDir(root), 'affordances.json'), affordances);
  }
  return report;
}

function markdown(report) {
  const lines = [];
  lines.push('# SpecNav Verify Report');
  lines.push('');
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- active_change: ${report.active_change || 'none'}`);
  lines.push(`- status: ${report.status}`);
  lines.push('');
  lines.push('| Check | Status | Detail |');
  lines.push('| --- | --- | --- |');
  for (const check of report.checks) {
    lines.push(`| ${check.name} | ${check.status} | ${(check.detail || '').replace(/\n/g, ' ')} |`);
  }
  if (report.rework.length) {
    lines.push('');
    lines.push('## Rework');
    for (const item of report.rework) {
      lines.push(`- ${item.class}: ${item.recommendation}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const report = verify();
  process.stdout.write(markdown(report));
  process.exit(report.status === 'green' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { verify, markdown };
