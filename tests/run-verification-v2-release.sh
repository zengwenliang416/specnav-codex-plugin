#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"
node --test tests/verification-v2/release/*.test.js
node --check plugins/specnav-operations/scripts/verification-v2-proof.js

echo "verification v2 release and archive proof ok"
