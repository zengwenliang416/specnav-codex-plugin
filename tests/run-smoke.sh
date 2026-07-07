#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
