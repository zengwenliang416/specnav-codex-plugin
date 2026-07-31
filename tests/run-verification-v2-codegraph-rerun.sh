#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node --test tests/verification-v2/rerun/*.test.js
node tests/verification-v2/rerun/codegraph-impact-cli.js
node tests/verification-v2/rerun/cli-integration.js
