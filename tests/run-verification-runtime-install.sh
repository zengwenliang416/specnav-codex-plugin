#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

before="$(git status --short -- package.json package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock)"
node --test tests/verification-v2/runtime/installer.test.js
after="$(git status --short -- package.json package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock)"

if [[ "$before" != "$after" ]]; then
  echo "verification-runtime:business-manifest-mutated" >&2
  exit 1
fi

echo "verification runtime installer fixture ok"
