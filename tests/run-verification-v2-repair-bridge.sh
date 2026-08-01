#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node --test \
  tests/verification-v2/repair-loop/development-bridge.test.js \
  tests/verification-v2/kernel/package-boundary.test.js

echo "verification v2 repair bridge ok"
