#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node --test tests/verification-v2/migration/*.test.js
node --test tests/verification-v2/kernel/package-boundary.test.js
