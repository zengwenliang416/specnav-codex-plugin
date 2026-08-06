---
description: Run the complete SpecNav Verification 2.0 lifecycle
argument-hint: "[verification target]"
---

You are using the `specnav-verification` plugin.

Resolve the installed SpecNav suite before loading any verification skill:

```bash
set -euo pipefail

SPECNAV_CORE_ROOT="$(node -e 'const fs=require("fs"),p=require("path"),os=require("os");const b=p.join(os.homedir(),".claude","plugins","cache","specnav-marketplace","specnav-core");let c=[];try{c=fs.readdirSync(b,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>p.join(b,e.name)).filter(r=>fs.existsSync(p.join(r,".claude-plugin","plugin.json"))&&!fs.existsSync(p.join(r,".orphaned_at"))).sort((a,z)=>new Intl.Collator(undefined,{numeric:true}).compare(p.basename(z),p.basename(a)))}catch{};if(!c.length){console.error("missing-installed-plugin:specnav-core");process.exit(2)};process.stdout.write(c[0])')"
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
