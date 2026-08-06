#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="2.0.0-alpha.2"
RUNTIME_BASE="${SPECNAV_VERIFICATION_RUNTIME_BASE:-$HOME/.specnav/runtime/verification}"

cd "$ROOT"
node plugins/specnav-verification/scripts/verification-runtime.js doctor \
  --version "$VERSION" \
  --root "$RUNTIME_BASE" \
  --json

node --test tests/verification-v2/runtime/doctor.test.js
echo "verification runtime doctor ok"
