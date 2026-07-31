#!/usr/bin/env node
'use strict';

const builder = require('../core/codegraph-context-builder');
const impact = require('../core/codegraph-impact-report');
const store = require('../core/codegraph-evidence-store');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: codegraph-impact.js --query "impact question" [--project <dir>] [--change <id>] [--write] [--json]\n');
    return 0;
  }
  const result = builder.build({
    projectRoot: argValue(argv, '--project', null),
    change: argValue(argv, '--change', null),
    stage: argValue(argv, '--stage', 'operations'),
    claim: argValue(argv, '--claim', null),
    task: argValue(argv, '--task', null),
    query: argValue(argv, '--query', null),
    write: hasFlag(argv, '--write')
  });
  if (!result.evidence) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }

  const change = argValue(argv, '--change', null)
    || result.status?.active_change
    || store.activeChange(result.status?.project_root || process.cwd());
  const projection = impact.createImpactReport({
    changeId: change,
    evidence: result.evidence,
    generatedAt: result.evidence.generated_at
  });
  const output = {
    ...result,
    ok: result.ok && projection.ok,
    impact_report: projection.report,
    blockers: Array.from(new Set([
      ...(result.blockers || []),
      ...(projection.blockers || [])
    ]))
  };

  if (
    hasFlag(argv, '--write')
    && projection.report
    && change
    && result.status?.project_root
  ) {
    const paths = store.artifactPaths(result.status.project_root, change);
    store.writeJson(paths.impactReport, projection.report);
    output.written = {
      ...(output.written || {}),
      impact: paths.impactReport
    };
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output.ok ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = { main };
