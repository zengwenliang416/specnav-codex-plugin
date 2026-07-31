#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node --test \
  tests/verification-v2/midscene/midscene-adapter.test.js \
  tests/verification-v2/midscene/oracle-boundary.test.js \
  tests/verification-v2/midscene/read-only-oracle.test.js \
  tests/verification-v2/runtime/doctor.test.js

node plugins/specnav-verification/scripts/verification-runtime.js doctor \
  --version 2.0.0-alpha.1 \
  --project "$ROOT" \
  --root "$HOME/.specnav/runtime/verification" \
  --requires-midscene \
  --json
