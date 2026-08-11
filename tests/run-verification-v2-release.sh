#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/tests/verification-v2/command-result-protocol.sh"
trap 'status=$?; specnav_verification_emit_assertions "$status"; exit "$status"' EXIT

active_pid=""
pending_signal=""

forward_signal() {
  local signal="$1"
  pending_signal="$signal"
  if [[ -n "$active_pid" ]] && kill -0 "$active_pid" 2>/dev/null; then
    kill "-$signal" "$active_pid" 2>/dev/null || true
  fi
}

run_managed() {
  "$@" &
  active_pid=$!
  local command_status=0
  while true; do
    if wait "$active_pid"; then
      command_status=0
    else
      command_status=$?
    fi
    if [[ -n "$pending_signal" ]] \
      && kill -0 "$active_pid" 2>/dev/null; then
      continue
    fi
    break
  done
  active_pid=""
  return "$command_status"
}

trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT
trap 'forward_signal HUP' HUP

cd "$ROOT"
command -v python3 >/dev/null
python3 -c 'import ast, pathlib; ast.parse(pathlib.Path("plugins/specnav-operations/scripts/safe-filesystem.py").read_text())'
node --check plugins/specnav-operations/scripts/safe-filesystem.js
support_tests=()
for test_file in tests/verification-v2/release/*.test.js; do
  if [[ "$test_file" != "tests/verification-v2/release/release-proof.test.js" ]]; then
    support_tests+=("$test_file")
  fi
done
if [[ "${#support_tests[@]}" -eq 0 ]]; then
  echo "verification v2 release support tests missing" >&2
  exit 1
fi
run_managed node --test "${support_tests[@]}"
run_managed node tests/verification-v2/release/release-suite-runner.js
node --check plugins/specnav-operations/scripts/verification-v2-proof.js

echo "verification v2 release and archive proof ok"
