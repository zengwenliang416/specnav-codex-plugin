---
description: Run the complete SpecNav Verification 2.0 lifecycle
argument-hint: "[verification target]"
---

You are using the `specnav-verification` plugin.

Resolve the installed SpecNav suite before loading any verification skill:

```bash
set -euo pipefail

specnav_plugin_root() {
  local plugin_name="${SPECNAV_PLUGIN_NAME:?missing SPECNAV_PLUGIN_NAME}"
  SPECNAV_PLUGIN_NAME="$plugin_name" node - <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const plugin = process.env.SPECNAV_PLUGIN_NAME;
const base = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'specnav-marketplace', plugin);
function block(reason) {
  console.error(`${reason}:${plugin}`);
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(plugin)) block('invalid-plugin-name');
if (!fs.existsSync(base)) block('missing-installed-plugin');
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const candidates = fs.readdirSync(base, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ version: entry.name, root: path.join(base, entry.name) }))
  .filter((candidate) => fs.existsSync(path.join(candidate.root, '.claude-plugin', 'plugin.json'))
    && !fs.existsSync(path.join(candidate.root, '.orphaned_at')))
  .sort((a, b) => collator.compare(b.version, a.version));
if (!candidates.length) block('missing-active-installed-plugin');
process.stdout.write(candidates[0].root);
NODE
}

SPECNAV_PLUGIN_NAME=specnav-core
SPECNAV_CORE_ROOT="$(specnav_plugin_root)"
eval "$(node "$SPECNAV_CORE_ROOT/scripts/resolve-runtime.js" env --shell \
  --plugin specnav-core \
  --plugin specnav-development \
  --plugin specnav-verification)"
node "$SPECNAV_CORE_ROOT/scripts/plugin-suite.js" require \
  --marketplace-root "$SPECNAV_MARKETPLACE_ROOT" \
  --plugin specnav-core \
  --plugin specnav-development \
  --plugin specnav-verification \
  --json
```

If suite resolution fails, report the exact blocker and stop. No fallback is
allowed.

Run the development handoff gate:

```bash
node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" \
  --mode handoff \
  --json
```

If development is blocked, report its exact blockers and stop.

Read and follow:

```text
$SPECNAV_VERIFICATION_ROOT/skills/specnav-verification/SKILL.md
```

The full adapter entry is:

```bash
node "$SPECNAV_VERIFICATION_ROOT/scripts/claude-verification-adapter.js" \
  validate \
  --project "$PWD" \
  --json
```

Verification 2.0 has no light, compact, or simplified lane. Do not use legacy
OpenSpec verification skills, partial-domain verification, manual green, or a
fallback route.
