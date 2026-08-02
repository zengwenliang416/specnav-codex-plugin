#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_BASE="$(mktemp -d /tmp/specnav-verification-runtime-cli-XXXXXX)"
VERSION="2.0.0-alpha.1"

cd "$ROOT"
before="$(git status --short -- package.json package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock)"

node plugins/specnav-verification/scripts/verification-runtime.js install \
  --version "$VERSION" \
  --project "$ROOT" \
  --root "$RUNTIME_BASE" \
  --json

receipt="$RUNTIME_BASE/$VERSION/install-receipt.json"
test -f "$receipt"
node - "$receipt" <<'NODE'
const fs = require('node:fs');
const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (receipt.status !== 'installed') throw new Error('receipt-status');
if (receipt.fallback_used !== false) throw new Error('receipt-fallback');
if (receipt.packages.length !== 5) throw new Error('receipt-packages');
if (receipt.browsers.length !== 3) throw new Error('receipt-browsers');
const browserNames = receipt.browsers.map((entry) => entry.name).sort();
if (JSON.stringify(browserNames) !== JSON.stringify([
  'chromium',
  'chromium-headless-shell',
  'ffmpeg'
])) {
  throw new Error('receipt-browser-set');
}
if (receipt.project_manifests.some((entry) => !entry.unchanged)) {
  throw new Error('receipt-project-manifest');
}
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
NODE

after="$(git status --short -- package.json package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock)"
if [[ "$before" != "$after" ]]; then
  echo "verification-runtime:business-manifest-mutated" >&2
  exit 1
fi

echo "verification runtime CLI install ok: $RUNTIME_BASE/$VERSION"
