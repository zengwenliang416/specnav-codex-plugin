#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/tests/verification-v2/command-result-protocol.sh"
trap 'status=$?; specnav_verification_emit_assertions "$status"; exit "$status"' EXIT

export SPECNAV_CLAUDE_ROOT="${SPECNAV_CLAUDE_ROOT:-$ROOT/../specnav-claude-plugin}"
export SPECNAV_CODEFREE_O_ROOT="${SPECNAV_CODEFREE_O_ROOT:-$ROOT/../specnav-codefree-o-plugin}"

cd "$ROOT"
node --test \
  tests/verification-v2/cross-host/codex-adapter.test.js \
  tests/verification-v2/cross-host/claude-adapter.test.js \
  tests/verification-v2/cross-host/codefree-o-adapter.test.js \
  tests/verification-v2/cross-host/drift-detector.test.js \
  tests/verification-v2/cross-host/host-authority.integration.test.js \
  tests/verification-v2/cross-host/runner-authority.test.js \
  tests/verification-v2/cross-host/operations-proof-sync.test.js
