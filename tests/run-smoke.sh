#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/tests/verification-v2/command-result-protocol.sh"
trap 'status=$?; specnav_verification_emit_assertions "$status"; exit "$status"' EXIT

CASE_03_ASSERTION_IDS="CASE-03-A01,CASE-03-A02,CASE-03-A03"
if [[ "${SPECNAV_VERIFICATION_ASSERTION_IDS:-}" == "$CASE_03_ASSERTION_IDS" ]]; then
  bash "$ROOT/tests/run-verification-v2-case-03.sh"
  echo "specnav codex CASE-03 smoke ok"
  exit 0
fi

bash "$ROOT/tests/run-codex-marketplace-fixtures.sh"
bash "$ROOT/tests/run-codex-plugin-fixtures.sh"
bash "$ROOT/tests/run-codex-skill-fixtures.sh"
bash "$ROOT/tests/run-codex-hook-fixtures.sh"
bash "$ROOT/tests/run-codex-development-fixtures.sh"
bash "$ROOT/tests/run-plugin-suite-resolver-fixtures.sh"
bash "$ROOT/tests/run-task-checkbox-contract-fixtures.sh"
bash "$ROOT/tests/run-lane-routing-fixtures.sh"
bash "$ROOT/tests/run-operations-archive-action-fixtures.sh"
bash "$ROOT/tests/run-codegraph-policy-fixtures.sh"
bash "$ROOT/tests/run-codegraph-context-fixtures.sh"
bash "$ROOT/tests/run-light-compact-gate-fixtures.sh"
bash "$ROOT/tests/run-verification-runtime-scope.sh"

if rg -n 'CLAUDE_PLUGIN_ROOT|\\.claude-plugin|claude plugin' \
  "$ROOT/plugins" \
  "$ROOT/README.md" \
  "$ROOT/README.zh-CN.md" \
  "$ROOT/docs" \
  "$ROOT/.agents" \
  "$ROOT/package.json"; then
  echo "Codex repo still contains Claude primary entry surfaces" >&2
  exit 1
fi

if rg -n '(^|[`[:space:]])/specnav-' "$ROOT/plugins" "$ROOT/README.md" "$ROOT/README.zh-CN.md"; then
  echo "Codex repo still contains slash-command SpecNav entry points" >&2
  exit 1
fi

echo "specnav codex smoke ok"
