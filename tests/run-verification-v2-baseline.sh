#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

bash "$ROOT/tests/verification-v2/baseline/run.sh"
node --test "$ROOT/tests/verification-v2/baseline/"*.test.js
