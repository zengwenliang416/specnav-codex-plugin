#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULT="$(mktemp)"
trap 'rm -f "$RESULT"' EXIT

cd "$ROOT"

bash tests/run-development-plugin-fixtures.sh

set +e
node plugins/specnav-development/scripts/development-contract.js \
  --mode handoff \
  --json >"$RESULT"
handoff_status=$?
set -e

if [[ "$handoff_status" -ne 2 ]]; then
  echo "expected incomplete Verification 2.0 handoff to exit 2, got $handoff_status" >&2
  exit 1
fi

node - "$RESULT" <<'NODE'
'use strict';

const fs = require('fs');
const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const blockers = new Set(Array.isArray(result.blockers) ? result.blockers : []);
const graph = JSON.parse(fs.readFileSync(
  'openspec/changes/verification-2-0/development/task-graph.json',
  'utf8'
));
const ownerMap = JSON.parse(fs.readFileSync(
  'openspec/changes/verification-2-0/development/code-owner-map.json',
  'utf8'
));
const taskContext = fs.readFileSync(
  'openspec/changes/verification-2-0/development/task-context.jsonl',
  'utf8'
).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const taskLedger = fs.readFileSync(
  'openspec/changes/verification-2-0/development/task-ledger.jsonl',
  'utf8'
).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const taskChecklist = fs.readFileSync(
  'openspec/changes/verification-2-0/tasks.md',
  'utf8'
).split(/\r?\n/);

const retired = [
  'migration-manifest-sql-mentioned-but-not-required',
  'invalid-spec-review:empty-heading:Missing Requirements',
  'task-ledger-missing-status:011-midscene-runner:complete'
];
const retiredPrefixes = [
  'validation-log:executed-evidence-failed:',
  'validation-log:invalid-overturn-target:',
  'validation-log:invalid-overturn-successor:',
  'validation-log:overturn-reason-missing:'
];
const required = [
  'tasks-md:incomplete-checkboxes',
  'scaffold-placeholder:handoff-to-verify.md:decision-required',
  'scaffold-placeholder:report.md:decision-required',
  'invalid-spec-review:verdict',
  'invalid-quality-review:verdict'
];

for (const blocker of retired) {
  if (blockers.has(blocker)) {
    throw new Error(`retired blocker returned: ${blocker}`);
  }
}
for (const blocker of blockers) {
  if (retiredPrefixes.some((prefix) => blocker.startsWith(prefix))) {
    throw new Error(`retired blocker returned: ${blocker}`);
  }
}
for (const blocker of required) {
  if (!blockers.has(blocker)) {
    throw new Error(`expected unfinished-work blocker is missing: ${blocker}`);
  }
}

const requiredEdges = [
  ['017-not-applicable-approval', '023-report-model'],
  ['020-retest-regression-loop', '023-report-model'],
  ['029-claude-code-integration', '030-codefree-o-integration']
];
for (const [from, to] of requiredEdges) {
  if (!graph.edges.some((edge) => edge.from === from && edge.to === to && edge.type === 'blocks')) {
    throw new Error(`required task dependency is missing: ${from}->${to}`);
  }
}

const waveByTask = new Map();
graph.execution_waves.forEach((tasks, wave) => {
  for (const task of tasks) {
    if (waveByTask.has(task)) throw new Error(`task appears in multiple execution waves: ${task}`);
    waveByTask.set(task, wave);
  }
});
for (const edge of graph.edges) {
  if (!waveByTask.has(edge.from) || !waveByTask.has(edge.to)) {
    throw new Error(`task dependency is absent from execution waves: ${edge.from}->${edge.to}`);
  }
  if (waveByTask.get(edge.from) >= waveByTask.get(edge.to)) {
    throw new Error(`task dependency violates execution wave order: ${edge.from}->${edge.to}`);
  }
}

const owners = new Map(ownerMap.owners.map((entry) => [entry.path, entry.owner]));
const requiredOwners = new Map([
  ['plugins/specnav-verification/scripts/**', 'verification-runtime-cli'],
  ['scripts/**', 'repository-automation'],
  ['.codex-plugin/**', 'codex-host-integration'],
  ['integrations/**', 'cross-host-integration'],
  ['.github/workflows/**', 'release-engineering']
]);
for (const [path, owner] of requiredOwners) {
  if (owners.get(path) !== owner) {
    throw new Error(`required code owner is missing or incorrect: ${path}`);
  }
}

const contextByTask = new Map();
for (const entry of taskContext) {
  if (contextByTask.has(entry.task_id)) {
    throw new Error(`task context contains duplicate state rows: ${entry.task_id}`);
  }
  contextByTask.set(entry.task_id, entry);
}
const completedLedgerTasks = new Set(
  taskLedger
    .filter((entry) => entry.status === 'complete')
    .map((entry) => entry.task_id)
);
const checkedGoals = new Map();
for (const line of taskChecklist) {
  const match = line.match(/^- \[([ x])\] \d+\.\d+ (.+)$/);
  if (match) checkedGoals.set(match[2].trim(), match[1] === 'x');
}
for (const node of graph.nodes) {
  const context = contextByTask.get(node.id);
  if (!context) throw new Error(`task context row is missing: ${node.id}`);
  if (!checkedGoals.has(node.goal)) {
    throw new Error(`task checklist goal is missing: ${node.id}`);
  }
  const checked = checkedGoals.get(node.goal);
  if (checked && context.status !== 'complete') {
    throw new Error(`checked task is not complete in task context: ${node.id}`);
  }
  if (checked && !completedLedgerTasks.has(node.id)) {
    throw new Error(`checked task lacks a complete ledger record: ${node.id}`);
  }
  if (!checked && context.status === 'complete') {
    throw new Error(`unchecked task is complete in task context: ${node.id}`);
  }
}

process.stdout.write(
  `development contract maintenance ok; ${blockers.size} legitimate unfinished-work blockers remain\n`
);
NODE
