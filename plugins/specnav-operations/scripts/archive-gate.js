#!/usr/bin/env node
'use strict';

const { writeArchiveGate } = require('./operations-gate');

function markdown(report) {
  const lines = [];
  lines.push('# SpecNav Archive Gate');
  lines.push('');
  lines.push(`- active_change: ${report.active_change || 'none'}`);
  lines.push(`- release_target: ${report.release_target || 'none'}`);
  lines.push(`- verdict: ${report.verdict}`);
  lines.push(`- blockers: ${report.blockers.join(', ') || '-'}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const report = writeArchiveGate();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(markdown(report));
  process.exit(report.verdict === 'green' ? 0 : 2);
}

if (require.main === module) main();

module.exports = { writeArchiveGate };
