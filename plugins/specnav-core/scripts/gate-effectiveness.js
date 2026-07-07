#!/usr/bin/env node
'use strict';

// Aggregates openspec/.specnav/events.jsonl into a per-gate effectiveness
// report: how often each gate fires, how often it is overridden (a proxy for
// false positives), and how often verification later goes red after an allow
// (a proxy for false negatives). This is the scaffold-retirement input: a
// gate with a high override rate is probably the wrong gate; a gate that
// never fires is dead weight.

const path = require('path');
const lib = require('./specnav-lib');

const MIN_SAMPLE = 5;

function parseEvents(root) {
  const text = lib.readText(path.join(lib.specnavDir(root), 'events.jsonl'));
  const events = [];
  if (!text) return events;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object') events.push(entry);
    } catch {
      // Skip malformed lines; the audit log is append-only and best-effort.
    }
  }
  return events;
}

function analyze(root) {
  const events = parseEvents(root);
  const gates = new Map();
  const gate = (name) => {
    if (!gates.has(name)) {
      gates.set(name, { gate: name, denies: 0, warns: 0, overrides: 0, allows_followed_by_red: 0 });
    }
    return gates.get(name);
  };

  let allows = 0;
  let verifies = 0;
  let redAfterAllow = 0;
  let pendingAllows = 0;

  for (const entry of events) {
    const payload = entry.payload || {};
    switch (entry.type) {
      case 'hook.deny':
        gate(payload.reason || 'unknown').denies += 1;
        break;
      case 'hook.warn':
        gate(payload.reason || 'warn').warns += 1;
        break;
      case 'hook.override':
        gate(payload.gate || 'unknown').overrides += 1;
        break;
      case 'hook.allow':
        allows += 1;
        pendingAllows += 1;
        break;
      case 'verify':
        verifies += 1;
        if (payload.status === 'red' && pendingAllows > 0) redAfterAllow += 1;
        pendingAllows = 0;
        break;
      default:
        break;
    }
  }

  const rows = Array.from(gates.values()).map((row) => {
    const fired = row.denies + row.warns;
    const overrideRate = fired > 0 ? row.overrides / (fired + row.overrides) : null;
    return {
      ...row,
      fired,
      override_rate: overrideRate === null ? null : Number(overrideRate.toFixed(3)),
      sample_sufficient: fired + row.overrides >= MIN_SAMPLE,
      signal: overrideRate === null
        ? 'never-fired'
        : (fired + row.overrides < MIN_SAMPLE
          ? 'insufficient-sample'
          : (overrideRate >= 0.5 ? 'candidate-wrong-gate' : (overrideRate >= 0.2 ? 'review-criteria' : 'healthy')))
    };
  }).sort((a, b) => b.fired - a.fired);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_root: root,
    events_analyzed: events.length,
    totals: {
      allows,
      verifies,
      red_verifies_after_allows: redAfterAllow
    },
    decision_rules: [
      'override_rate >= 0.5 with sufficient sample: the gate is probably wrong — fix its criteria or demote it to a warning',
      'override_rate >= 0.2: review the gate criteria against recent overrides',
      'never-fired gates carry maintenance cost with no protection — candidates for retirement',
      'red verifies after allow streaks suggest missing gates (false negatives), not too many'
    ],
    gates: rows
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# SpecNav Gate Effectiveness');
  lines.push('');
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- events analyzed: ${report.events_analyzed}`);
  lines.push(`- allows: ${report.totals.allows}, verifies: ${report.totals.verifies}, red-after-allow: ${report.totals.red_verifies_after_allows}`);
  if (report.events_analyzed < MIN_SAMPLE) {
    lines.push('');
    lines.push(`> Insufficient sample (< ${MIN_SAMPLE} events). Signals below are directional only.`);
  }
  lines.push('');
  lines.push('## Decision rules');
  for (const rule of report.decision_rules) lines.push(`- ${rule}`);
  lines.push('');
  lines.push('| Gate | Denies | Warns | Overrides | Override rate | Signal |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of report.gates) {
    lines.push(`| ${row.gate} | ${row.denies} | ${row.warns} | ${row.overrides} | ${row.override_rate === null ? '-' : row.override_rate} | ${row.signal} |`);
  }
  if (!report.gates.length) lines.push('| (no gate events recorded) | - | - | - | - | - |');
  return `${lines.join('\n')}\n`;
}

function main() {
  const root = lib.projectRoot();
  const report = analyze(root);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(toMarkdown(report));
  }
}

if (require.main === module) main();

module.exports = { analyze, toMarkdown };
