#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node --test \
  tests/verification-v2/reports/case-pages-browser.test.js \
  tests/verification-v2/reports/case-pages.test.js \
  tests/verification-v2/reports/overview.test.js \
  tests/verification-v2/reports/report-model.test.js \
  tests/verification-v2/kernel/package-boundary.test.js

echo "verification v2 case report pages ok"
