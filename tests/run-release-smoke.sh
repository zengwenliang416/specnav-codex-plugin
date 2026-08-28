#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT/tests/run-verification-v2-cross-host.sh"
bash "$ROOT/tests/run-verification-v2-release.sh"

echo "specnav release smoke ok"
