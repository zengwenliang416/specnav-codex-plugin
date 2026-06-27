#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node - <<'NODE'
const path = require('path');
const root = process.cwd();
const runtime = require(path.join(root, 'plugins/specnav-core/scripts/plugin-runtime.js'));
for (const plugin of ['specnav-core', 'specnav-requirements', 'specnav-prototype', 'specnav-development', 'specnav-verification', 'specnav-operations']) {
  const resolved = runtime.resolvePluginRoot(plugin);
  if (!resolved.endsWith(path.join('plugins', plugin))) {
    throw new Error(`bad resolution for ${plugin}: ${resolved}`);
  }
}
NODE

echo "plugin suite resolver fixtures ok"
