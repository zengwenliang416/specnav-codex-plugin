#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node --test \
  tests/verification-v2/midscene/midscene-adapter.test.js \
  tests/verification-v2/midscene/oracle-boundary.test.js \
  tests/verification-v2/midscene/read-only-oracle.test.js \
  tests/verification-v2/runtime/doctor.test.js

set +e
doctor_output="$(
  node plugins/specnav-verification/scripts/verification-runtime.js doctor \
    --version 2.0.0-alpha.2 \
    --project "$ROOT" \
    --root "$HOME/.specnav/runtime/verification" \
    --requires-midscene \
    --json
)"
doctor_status=$?
set -e

printf '%s\n' "$doctor_output"
if [[ "$doctor_status" == "0" ]]; then
  jq -e '
    .ok == true
    and .readiness == "ready"
    and .checks.provider.configured == true
    and .fallback_used == false
  ' <<<"$doctor_output" >/dev/null
elif [[ "$doctor_status" == "2" ]]; then
  jq -e '
    .ok == false
    and .readiness == "blocked"
    and .fallback_used == false
    and any(
      .blockers[];
      .id == "verification-runtime:midscene-provider-not-configured"
    )
  ' <<<"$doctor_output" >/dev/null
else
  echo "unexpected Midscene doctor exit status: $doctor_status" >&2
  exit "$doctor_status"
fi

echo "verification v2 Midscene contract ok"
