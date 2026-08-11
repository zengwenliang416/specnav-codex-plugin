#!/usr/bin/env bash
set -euo pipefail

active_pid=""
pending_signal=""
finishing=0

signal_status() {
  case "$1" in
    HUP) printf '%s\n' 129 ;;
    INT) printf '%s\n' 130 ;;
    TERM) printf '%s\n' 143 ;;
    *) printf '%s\n' 1 ;;
  esac
}

forward_signal() {
  local signal="$1"
  pending_signal="$signal"
  if [[ -n "$active_pid" ]] && kill -0 "$active_pid" 2>/dev/null; then
    kill "-$signal" "$active_pid" 2>/dev/null || true
    return
  fi
  exit "$(signal_status "$signal")"
}

run_managed() {
  if [[ -n "$pending_signal" ]] && [[ "$finishing" -ne 1 ]]; then
    return "$(signal_status "$pending_signal")"
  fi
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
  if [[ -n "$pending_signal" ]]; then
    return "$(signal_status "$pending_signal")"
  fi
  return "$command_status"
}

trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT
trap 'forward_signal HUP' HUP

script_source="${BASH_SOURCE[0]}"
script_dir="${script_source%/*}"
if [[ "$script_dir" == "$script_source" ]]; then
  script_dir="$PWD"
elif [[ "$script_dir" != /* ]]; then
  script_dir="$PWD/$script_dir"
fi
ROOT="$(cd "$script_dir/.." && pwd -P)"
NODE_BIN="$(command -v node)"
PYTHON_BIN="$(command -v python3)"

node() {
  run_managed "$NODE_BIN" "$@"
}

source "$ROOT/tests/verification-v2/command-result-protocol.sh"

finish() {
  local status="$1"
  local emit_status=0
  trap - EXIT
  finishing=1
  if specnav_verification_emit_assertions "$status"; then
    emit_status=0
  else
    emit_status=$?
  fi
  if [[ -n "$pending_signal" ]]; then
    exit "$(signal_status "$pending_signal")"
  fi
  if [[ "$status" -ne 0 ]]; then
    exit "$status"
  fi
  exit "$emit_status"
}

trap 'finish "$?"' EXIT

cd "$ROOT"
run_managed "$PYTHON_BIN" -c 'import ast, pathlib; ast.parse(pathlib.Path("plugins/specnav-operations/scripts/safe-filesystem.py").read_text())'
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
node --test "${support_tests[@]}"
node tests/verification-v2/release/release-suite-runner.js
node --check plugins/specnav-operations/scripts/verification-v2-proof.js

echo "verification v2 release and archive proof ok"
