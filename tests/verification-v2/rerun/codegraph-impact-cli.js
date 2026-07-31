'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(
  ROOT,
  'plugins/specnav-codegraph/scripts/codegraph-impact.js'
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-impact-cli-'));
const project = path.join(temp, 'project');
const bin = path.join(temp, 'bin');
const change = 'impact-change';

fs.mkdirSync(path.join(project, '.codegraph'), { recursive: true });
fs.mkdirSync(path.join(project, 'openspec/.specnav'), { recursive: true });
fs.mkdirSync(path.join(project, 'openspec/changes', change), {
  recursive: true
});
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(
  path.join(project, 'openspec/.specnav/active-change'),
  `${change}\n`
);

const executable = path.join(bin, 'codegraph');
fs.writeFileSync(executable, `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  version)
    printf '1.1.7\\n'
    ;;
  status)
    printf '{"initialized":true,"version":"1.1.7","projectPath":"%s","indexPath":"%s/.codegraph","lastIndexed":"2026-07-31T00:00:00.000Z","fileCount":2,"nodeCount":2,"edgeCount":1,"pendingChanges":{"added":0,"modified":0,"removed":0},"reindexRecommended":false}\\n' "$PWD" "$PWD"
    ;;
  explore)
    printf 'src/api.js:1 calls src/ui.js:4\\n'
    ;;
  *)
    exit 2
    ;;
esac
`);
fs.chmodSync(executable, 0o755);

const run = childProcess.spawnSync(process.execPath, [
  SCRIPT,
  '--stage',
  'verification',
  '--query',
  'Find impacted files',
  '--write',
  '--json'
], {
  cwd: ROOT,
  env: {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PROJECT_DIR: project
  },
  encoding: 'utf8'
});

assert.equal(run.status, 0, run.stderr || run.stdout);
const output = JSON.parse(run.stdout);
assert.equal(output.ok, true);
assert.equal(output.impact_report.schema, 'specnav.codegraph.impact.v1');
assert.deepEqual(
  output.impact_report.affected_files.map((entry) => entry.path),
  ['src/api.js', 'src/ui.js']
);

const reportFile = path.join(
  project,
  'openspec/changes',
  change,
  'codegraph/impact-report.json'
);
assert.equal(fs.existsSync(reportFile), true);
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
assert.deepEqual(report, output.impact_report);

process.stdout.write('specnav codegraph impact report CLI fixture ok\n');
