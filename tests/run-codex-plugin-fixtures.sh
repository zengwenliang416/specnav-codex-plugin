#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for plugin in specnav-core specnav-requirements specnav-prototype specnav-development specnav-verification specnav-operations; do
  manifest="$ROOT/plugins/$plugin/.codex-plugin/plugin.json"
  jq -e --arg plugin "$plugin" '.name == $plugin' "$manifest" >/dev/null
  jq -e '.version and .description and .skills == "./skills/"' "$manifest" >/dev/null
  jq -e '.interface.displayName and .interface.capabilities' "$manifest" >/dev/null
  test -d "$ROOT/plugins/$plugin/skills"
  test -f "$ROOT/plugins/$plugin/assets/icon.svg"
  test -f "$ROOT/plugins/$plugin/assets/logo.svg"

  if jq -e 'has("hooks")' "$manifest" >/dev/null; then
    hooks_path="$(jq -r '.hooks' "$manifest")"
    case "$hooks_path" in ./*) ;; *) echo "hook path must start with ./: $hooks_path" >&2; exit 1 ;; esac
    test -f "$ROOT/plugins/$plugin/${hooks_path#./}"
  fi
done

jq -e 'has("hooks") | not' "$ROOT/plugins/specnav-core/.codex-plugin/plugin.json" >/dev/null
test -f "$ROOT/plugins/specnav-core/hooks/hooks.json"
for plugin in specnav-requirements specnav-prototype specnav-development specnav-verification specnav-operations; do
  jq -e 'has("hooks") | not' "$ROOT/plugins/$plugin/.codex-plugin/plugin.json" >/dev/null
done

echo "codex plugin fixtures ok"
