#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$ROOT/plugins/specnav-core"
REQ="$ROOT/plugins/specnav-requirements"
DEV="$ROOT/plugins/specnav-development"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

OUT="$(node "$CORE/scripts/change-triage.js" --intent "fix typo in README copy" --paths README.md --json)"
echo "$OUT" | jq -e '.lane == "light" and .tier == "lite" and (.skipped_gates | index("runnable-prototype"))' >/dev/null \
  || { echo "lane fixture failed: light triage"; echo "$OUT"; exit 1; }

OUT="$(node "$CORE/scripts/change-triage.js" --intent "add payroll overview page" --paths src/pages/payroll.tsx --json)"
echo "$OUT" | jq -e '.lane == "standard"' >/dev/null \
  || { echo "lane fixture failed: standard triage"; echo "$OUT"; exit 1; }

OUT="$(node "$CORE/scripts/change-triage.js" --intent "fix auth API permission bug" --paths src/auth/login.ts --json)"
echo "$OUT" | jq -e '.lane == "full" and .tier == "high-risk"' >/dev/null \
  || { echo "lane fixture failed: full triage"; echo "$OUT"; exit 1; }

LIGHT_WORK="$TMP_DIR/light-project"
LIGHT_CHANGE="light-readme-copy"
mkdir -p "$LIGHT_WORK/openspec/.specnav" "$LIGHT_WORK/openspec/changes/$LIGHT_CHANGE"
printf '%s\n' "$LIGHT_CHANGE" >"$LIGHT_WORK/openspec/.specnav/active-change"
printf '# Fixture\n' >"$LIGHT_WORK/README.md"

PROJECT_DIR="$LIGHT_WORK" SPECNAV_CHANGE="$LIGHT_CHANGE" \
  node "$DEV/skills/specnav-light-change/scripts/create-light-change.js" \
  --intent "fix typo in README copy" --paths README.md --json >"$TMP_DIR/light-scaffold.json"
jq -e '.ok == true and .active_change == "light-readme-copy"' "$TMP_DIR/light-scaffold.json" >/dev/null \
  || { echo "lane fixture failed: light scaffold"; cat "$TMP_DIR/light-scaffold.json"; exit 1; }

PROJECT_DIR="$LIGHT_WORK" SPECNAV_CHANGE="$LIGHT_CHANGE" \
  node "$REQ/scripts/requirements-contract.js" --json >"$TMP_DIR/light-req.json"
jq -e '.ok == true and .lane == "light" and .foundation_required == false' "$TMP_DIR/light-req.json" >/dev/null \
  || { echo "lane fixture failed: light requirements contract"; jq '.blockers' "$TMP_DIR/light-req.json"; exit 1; }

PROJECT_DIR="$LIGHT_WORK" SPECNAV_CHANGE="$LIGHT_CHANGE" \
  node "$DEV/scripts/development-contract.js" --mode entry --json >"$TMP_DIR/light-dev.json"
jq -e '.ok == true and .lane == "light" and (.artifacts[] | select(.name == "tasks.md" and .ok == true))' "$TMP_DIR/light-dev.json" >/dev/null \
  || { echo "lane fixture failed: light development entry"; jq '.blockers' "$TMP_DIR/light-dev.json"; exit 1; }

PROJECT_DIR="$LIGHT_WORK" SPECNAV_MARKETPLACE_ROOT="$ROOT" SPECNAV_CHANGE="$LIGHT_CHANGE" SPECNAV_DISABLE_OPENSPEC=1 \
  node "$CORE/scripts/specnav-route.js" --intent "fix typo in README copy" --paths README.md --json >"$TMP_DIR/light-route.json"
jq -e '.ok == true and .route == "light" and .skill == "specnav-light-change" and .command == "$specnav-light-change" and .triage.lane == "light"' "$TMP_DIR/light-route.json" >/dev/null \
  || { echo "lane fixture failed: light route"; jq '.blockers' "$TMP_DIR/light-route.json"; exit 1; }

echo "codex lane-routing fixtures ok"
