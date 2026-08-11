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

if [[ "$handoff_status" -ne 0 ]]; then
  echo "expected complete Verification 2.0 handoff to exit 0, got $handoff_status" >&2
  cat "$RESULT" >&2
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

if (blockers.size !== 0) {
  throw new Error(`completed handoff returned blockers: ${[...blockers].join(', ')}`);
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
const checklistItems = new Map();
for (const line of taskChecklist) {
  const match = line.match(/^- \[([ x])\] (\d+\.\d+) (.+)$/);
  if (!match) continue;
  const itemId = match[2];
  if (checklistItems.has(itemId)) {
    throw new Error(`task checklist contains duplicate item id: ${itemId}`);
  }
  checklistItems.set(itemId, {
    checked: match[1] === 'x',
    goal: match[3].trim()
  });
}

if (graph.nodes.length !== 33) {
  throw new Error(`expected 33 formal task graph nodes, got ${graph.nodes.length}`);
}
if (taskContext.length !== graph.nodes.length) {
  throw new Error(
    `task context row count does not match graph node count: ${taskContext.length} != ${graph.nodes.length}`
  );
}
if (checklistItems.size !== 38) {
  throw new Error(`expected 38 checklist items, got ${checklistItems.size}`);
}

function requireTaskItems(value, source) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`task_items must be a non-empty array: ${source}`);
  }
  const items = value.map((item) => {
    if (typeof item !== 'string' || !/^\d+\.\d+$/.test(item)) {
      throw new Error(`task_items contains an invalid item id: ${source}`);
    }
    return item;
  });
  if (new Set(items).size !== items.length) {
    throw new Error(`task_items contains duplicates: ${source}`);
  }
  return items;
}

function requireSameTaskItems(expected, actual, source) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `task_items mismatch for ${source}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`
    );
  }
}

const graphTaskIds = new Set();
const ownersByItem = new Map();
for (const node of graph.nodes) {
  if (graphTaskIds.has(node.id)) {
    throw new Error(`task graph contains duplicate node id: ${node.id}`);
  }
  graphTaskIds.add(node.id);

  const context = contextByTask.get(node.id);
  if (!context) throw new Error(`task context row is missing: ${node.id}`);
  const graphItems = requireTaskItems(node.task_items, `task graph node ${node.id}`);
  const contextItems = requireTaskItems(context.task_items, `task context row ${node.id}`);
  requireSameTaskItems(graphItems, contextItems, `task context row ${node.id}`);

  const contextPath = `openspec/changes/verification-2-0/${context.source}`;
  const contextFile = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
  if (contextFile.task_id !== node.id) {
    throw new Error(`task context file id mismatch: ${contextPath}`);
  }
  const contextFileItems = requireTaskItems(
    contextFile.task_items,
    `task context file ${node.id}`
  );
  requireSameTaskItems(graphItems, contextFileItems, `task context file ${node.id}`);

  let ownsPrimaryGoal = false;
  for (const itemId of graphItems) {
    const checklistItem = checklistItems.get(itemId);
    if (!checklistItem) {
      throw new Error(`task graph owns unknown checklist item: ${node.id}->${itemId}`);
    }
    if (checklistItem.goal === node.goal) ownsPrimaryGoal = true;
    const owners = ownersByItem.get(itemId) || [];
    owners.push(node.id);
    ownersByItem.set(itemId, owners);

    if (checklistItem.checked && context.status !== 'complete') {
      throw new Error(`checked task item is not complete in task context: ${itemId}->${node.id}`);
    }
    if (checklistItem.checked && !completedLedgerTasks.has(node.id)) {
      throw new Error(`checked task item lacks a complete ledger record: ${itemId}->${node.id}`);
    }
    if (!checklistItem.checked && context.status === 'complete') {
      throw new Error(`unchecked task item is complete in task context: ${itemId}->${node.id}`);
    }
  }
  if (!ownsPrimaryGoal) {
    throw new Error(`task graph node does not own its primary goal item: ${node.id}`);
  }
}

for (const contextTaskId of contextByTask.keys()) {
  if (!graphTaskIds.has(contextTaskId)) {
    throw new Error(`task context row has no graph node: ${contextTaskId}`);
  }
}

for (const itemId of checklistItems.keys()) {
  const owners = ownersByItem.get(itemId) || [];
  if (owners.length === 0) {
    throw new Error(`task checklist item has no primary owner: ${itemId}`);
  }
  if (owners.length > 1) {
    throw new Error(`task checklist item has multiple primary owners: ${itemId}->${owners.join(',')}`);
  }
}

process.stdout.write(
  'development contract maintenance ok; 38 checklist items have unique owners across 33 formal tasks\n'
);
NODE
