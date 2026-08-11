#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/tests/verification-v2/command-result-protocol.sh"
trap 'status=$?; specnav_verification_emit_assertions "$status"; exit "$status"' EXIT

cd "$ROOT"
command -v python3 >/dev/null
python3 -c 'import ast, pathlib; ast.parse(pathlib.Path("plugins/specnav-operations/scripts/safe-filesystem.py").read_text())'
node --check plugins/specnav-operations/scripts/safe-filesystem.js
node --test \
  tests/verification-v2/release/host-artifacts.test.js \
  tests/verification-v2/release/host-proof-launcher.test.js \
  tests/verification-v2/release/release-suite-runner.test.js \
  tests/verification-v2/release/safe-filesystem.test.js
node tests/verification-v2/release/release-suite-runner.js
node --check plugins/specnav-operations/scripts/verification-v2-proof.js

echo "verification v2 release and archive proof ok"
