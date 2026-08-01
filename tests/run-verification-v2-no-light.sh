#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV="$ROOT/plugins/specnav-development"
VERIFY="$ROOT/plugins/specnav-verification"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || {
  echo "jq is required" >&2
  exit 1
}

PROJECT="$TMP_DIR/project"
CHANGE="verification-v2-no-light"
CHANGE_DIR="$PROJECT/openspec/changes/$CHANGE"
mkdir -p "$PROJECT/openspec/.specnav" "$CHANGE_DIR"
printf '%s\n' "$CHANGE" >"$PROJECT/openspec/.specnav/active-change"
printf '# Fixture\n' >"$PROJECT/README.md"

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$DEV/skills/specnav-light-change/scripts/create-light-change.js" \
  --intent "fix README copy" --paths README.md --json >/dev/null

node - "$CHANGE_DIR/light-change.json" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const assertion of value.acceptance) {
  assertion.status = 'passing';
  assertion.evidence_ref = 'git diff README.md';
}
for (const task of value.tasks) task.done = true;
value.user_test = {
  status: 'approved',
  case: value.user_test.case,
  user_decision: 'Approved the copy change.'
};
fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
NODE

set +e
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$VERIFY/scripts/verify-domains.js" aggregate --json \
  >"$TMP_DIR/aggregate.json"
STATUS=$?
set -e

[[ "$STATUS" == "2" ]] || {
  echo "Verification 2.0 light lane must block, got exit $STATUS" >&2
  cat "$TMP_DIR/aggregate.json" >&2
  exit 1
}

jq -e '
  .verdict == "red"
  and (.blockers | index("verification-v2:light-lane-not-supported"))
  and (.required_domains == [
    "facticity",
    "static",
    "unit",
    "redteam",
    "e2e",
    "sensory"
  ])
' "$TMP_DIR/aggregate.json" >/dev/null

echo "verification v2 no-light contract ok"
