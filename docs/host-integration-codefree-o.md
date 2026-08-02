# CodeFree-O Verification 2.0 Integration

## Ownership

`plugins/specnav-verification` in the Codex repository is the canonical source
for Verification Kernel semantics, schemas, shared scripts, and report assets.

The CodeFree-O repository owns:

- package discovery, command registration, hooks, and `shell.env`;
- `scripts/plugin-runtime.js`;
- a thin `codefree-o-verification-adapter.js`;
- generated canonical Kernel files and `specnav-kernel-source.json`.

CodeFree-O does not own Reading, evidence integrity, six-domain aggregation,
DecisionEngine, freshness, report, migration, or release verdict semantics.

## Synchronization

Preview:

```bash
node integrations/codefree-o/sync-verification-module.js
```

Apply:

```bash
node integrations/codefree-o/sync-verification-module.js --apply
```

Only `modules/specnav-verification` is synchronization-owned. The synchronizer
requires that path to be clean, but preserves unrelated downstream edits such
as README and discovery-test work. It validates package and manifest identity,
rejects symlinks and path escape, builds a complete staging module, validates
exact, transformed, and host file digests, then replaces the module
atomically.

## Runtime Entry

CodeFree-O exposes `/specnav-verification` and `/specnav-verify`. Both invoke:

```bash
node "$SPECNAV_VERIFICATION_ROOT/scripts/codefree-o-verification-adapter.js" \
  validate \
  --project "$PWD" \
  --json
```

The adapter requires the full six-domain gate, preserves exact blockers and
artifacts, rejects fallback and manual green, and requires explicit approval
for runtime or verification-artifact mutations.

## Verification

```bash
bash tests/run-verification-v2-codefree-o-adapter.sh
bash /Volumes/zwl/AI/ai-coding/specnav-codefree-o-plugin/tests/run-smoke.sh
```
