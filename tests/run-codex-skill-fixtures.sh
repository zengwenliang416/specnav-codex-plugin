#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while IFS= read -r skill; do
  name="$(awk -F': ' '/^name:/{print $2; exit}' "$skill")"
  desc="$(awk -F': ' '/^description:/{print $2; exit}' "$skill")"
  case "$name" in specnav-*) ;; *) echo "invalid skill name in $skill: $name" >&2; exit 1 ;; esac
  test -n "$desc"
  if grep -Eq '^allowed-tools:|^metadata:|^compatibility:' "$skill"; then
    echo "unsupported frontmatter in $skill" >&2
    exit 1
  fi
  if grep -Fq 'CLAUDE_PLUGIN_ROOT' "$skill"; then
    echo "skill still references CLAUDE_PLUGIN_ROOT: $skill" >&2
    exit 1
  fi
done < <(find "$ROOT/plugins" -path '*/skills/*/SKILL.md' -type f | sort)

if rg -n '(^|[`[:space:]])/specnav-' "$ROOT/plugins" -g 'SKILL.md'; then
  echo "skills should not require slash-command entry points" >&2
  exit 1
fi

echo "codex skill fixtures ok"
