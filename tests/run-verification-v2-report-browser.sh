#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/verification-v2/command-result-protocol.sh"
trap 'status=$?; specnav_verification_emit_assertions "$status"; exit "$status"' EXIT
cd "$ROOT"

ARTIFACT_ROOT="${SPECNAV_REPORT_ARTIFACT_ROOT:-$ROOT/openspec/changes/verification-2-0/development/evidence/026-report-artifacts}"
RUN_ID="${SPECNAV_REPORT_ARTIFACT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
ARTIFACT_DIR="$ARTIFACT_ROOT/$RUN_ID"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SOURCE_SHA="$(git rev-parse HEAD)"
SOURCE_PATCH_SHA256="$(
  git diff --binary HEAD -- \
    plugins/specnav-verification/assets/report \
    plugins/specnav-verification/kernel/reporting \
    tests/run-verification-v2-report-browser.sh \
    tests/verification-v2/reports \
    tests/verification-v2/security \
  | shasum -a 256 \
  | awk '{print $1}'
)"

if [[ -e "$ARTIFACT_DIR" ]]; then
  echo "verification-report-artifact:destination-exists:$ARTIFACT_DIR" >&2
  exit 2
fi

mkdir -p "$ARTIFACT_ROOT"

SPECNAV_REPORT_ARTIFACT_DIR="$ARTIFACT_DIR" \
SPECNAV_REPORT_ARTIFACT_RUN_ID="$RUN_ID" \
SPECNAV_REPORT_GENERATED_AT="$GENERATED_AT" \
SPECNAV_REPORT_COMMAND_ID="task026-report-browser-print-artifacts" \
SPECNAV_REPORT_SOURCE_SHA="$SOURCE_SHA" \
SPECNAV_REPORT_SOURCE_PATCH_SHA256="$SOURCE_PATCH_SHA256" \
node --test \
  tests/verification-v2/reports/accessibility-security-browser.test.js \
  tests/verification-v2/reports/case-pages-browser.test.js \
  tests/verification-v2/reports/overview-browser.test.js

echo "verification v2 report artifacts: $ARTIFACT_DIR"
echo "verification v2 report browser and print ok"
