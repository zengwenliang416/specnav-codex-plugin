#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT"

node --test --test-concurrency=4 \
  tests/verification-v2/production/case-03-smoke-routing.test.js \
  tests/verification-v2/contracts/schema-registry.test.js \
  tests/verification-v2/contracts/cross-reference.test.js \
  tests/verification-v2/kernel/package-boundary.test.js \
  tests/verification-v2/evidence/evidence-store.test.js \
  tests/verification-v2/evidence/integrity.test.js \
  tests/verification-v2/evaluation/reading-model.test.js \
  tests/verification-v2/evaluation/not-applicable.test.js \
  tests/verification-v2/evaluation/aggregation.test.js \
  tests/verification-v2/freshness/freshness.test.js \
  tests/verification-v2/rerun/case-scope.test.js \
  tests/verification-v2/rerun/codegraph-impact.test.js

node tests/verification-v2/rerun/codegraph-impact-cli.js
node tests/verification-v2/rerun/cli-integration.js

PRODUCTION_PATTERN='^(approved command persists run, attempt, evidence, integrity and six-domain readings|artifact pipeline derives both gates, one report model and three HTML pages)$'
node --test \
  --test-concurrency=1 \
  --test-name-pattern="$PRODUCTION_PATTERN" \
  tests/verification-v2/production/production-runner.test.js \
  | tee "$TMP_DIR/production.tap"

grep -Eq '^# pass 2$' "$TMP_DIR/production.tap"
grep -Eq '^# fail 0$' "$TMP_DIR/production.tap"
grep -Eq '^# cancelled 0$' "$TMP_DIR/production.tap"

echo "verification v2 CASE-03 evidence and freshness proof ok"
