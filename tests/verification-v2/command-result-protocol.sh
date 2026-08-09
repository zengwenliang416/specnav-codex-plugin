#!/usr/bin/env bash

if [[ -n "${SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE:-}" ]] \
  && [[ -z "${SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_OWNER_PID:-}" ]]; then
  export SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_OWNER_PID="$$"
fi

specnav_verification_emit_assertions() {
  local status="${1:-1}"
  if [[ -z "${SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE:-}" ]]; then
    return 0
  fi
  if [[ "${SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_OWNER_PID:-}" != "$$" ]] \
    || [[ "$BASH_SUBSHELL" -ne 0 ]]; then
    return 0
  fi
  if [[ "${SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_EMITTED:-0}" == "1" ]]; then
    return 0
  fi
  if [[ -z "${SPECNAV_VERIFICATION_ASSERTION_IDS:-}" ]]; then
    printf '%s\n' "verification assertion protocol: ids missing" >&2
    return 2
  fi
  SPECNAV_VERIFICATION_COMMAND_STATUS="$status" node <<'NODE'
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = process.env.SPECNAV_VERIFICATION_ASSERTION_RESULT_FILE;
const ids = process.env.SPECNAV_VERIFICATION_ASSERTION_IDS
  .split(',')
  .filter(Boolean);
const passed = process.env.SPECNAV_VERIFICATION_COMMAND_STATUS === '0';
if (!file || ids.length === 0 || new Set(ids).size !== ids.length) {
  process.exit(2);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
const records = ids.map((assertionId) => JSON.stringify({
  assertion_id: assertionId,
  method: 'equal',
  expected: true,
  actual: passed,
  status: passed ? 'passed' : 'failed'
}));
fs.writeFileSync(file, `${records.join('\n')}\n`, {
  flag: 'wx',
  mode: 0o600
});
NODE
  local emit_status=$?
  if [[ "$emit_status" -eq 0 ]]; then
    SPECNAV_VERIFICATION_ASSERTION_PROTOCOL_EMITTED=1
  fi
  return "$emit_status"
}
