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

const retired = [
  'migration-manifest-sql-mentioned-but-not-required',
  'invalid-spec-review:empty-heading:Missing Requirements'
];
const retiredPrefixes = [
  'validation-log:executed-evidence-failed:',
  'validation-log:invalid-overturn-target:',
  'validation-log:invalid-overturn-successor:',
  'validation-log:overturn-reason-missing:'
];
const required = [
  'tasks-md:incomplete-checkboxes',
  'task-ledger-missing-status:011-midscene-runner:complete',
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

process.stdout.write(
  `development contract maintenance ok; ${blockers.size} legitimate unfinished-work blockers remain\n`
);
NODE
