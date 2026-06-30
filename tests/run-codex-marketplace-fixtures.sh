#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKETPLACE="$ROOT/.agents/plugins/marketplace.json"

jq -e '.name == "specnav-marketplace"' "$MARKETPLACE" >/dev/null
jq -e '.plugins | length == 7' "$MARKETPLACE" >/dev/null

for plugin in specnav-core specnav-requirements specnav-prototype specnav-development specnav-verification specnav-operations specnav-codegraph; do
  jq -e --arg plugin "$plugin" '.plugins[] | select(.name == $plugin)' "$MARKETPLACE" >/dev/null
  path="$(jq -r --arg plugin "$plugin" '.plugins[] | select(.name == $plugin) | .source.path' "$MARKETPLACE")"
  case "$path" in
    ./*) ;;
    *) echo "marketplace source path must start with ./: $path" >&2; exit 1 ;;
  esac
  test -d "$ROOT/${path#./}"
done

echo "codex marketplace fixtures ok"
