#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"
command -v python3 >/dev/null
python3 -c 'import ast, pathlib; ast.parse(pathlib.Path("plugins/specnav-operations/scripts/safe-filesystem.py").read_text())'
node --check plugins/specnav-operations/scripts/safe-filesystem.js
node --test tests/verification-v2/release/*.test.js
node --check plugins/specnav-operations/scripts/verification-v2-proof.js

echo "verification v2 release and archive proof ok"
