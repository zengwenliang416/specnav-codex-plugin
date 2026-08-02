#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"
node --test \
  --test-name-pattern="README" \
  tests/verification-v2/docs/documentation.test.js
