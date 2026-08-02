# Claude Code Verification 2.0 Integration

## Ownership

`specnav-codex-plugin/plugins/specnav-verification` is the canonical source for
the host-neutral Verification Kernel, schemas, shared command implementations,
and verification resource files.

`specnav-claude-plugin` contains:

- Claude Code manifests, commands, installed-cache resolution, and routing;
- a thin `claude-verification-adapter.js` wrapper;
- generated synchronized copies of the canonical Kernel contract;
- `specnav-kernel-source.json` with source commit, Kernel identity, exact file
  list, transformed skill list, and contract digest.

Claude-specific code does not own Reading, six-domain aggregation,
DecisionEngine, evidence integrity, freshness, report model, or release
verdict behavior.

## Synchronization

Preview:

```bash
node integrations/claude-code/sync-verification-plugin.js
```

Apply to a clean downstream checkout:

```bash
node integrations/claude-code/sync-verification-plugin.js --apply
```

The synchronizer refuses a dirty downstream worktree unless the caller
explicitly supplies `--allow-dirty`. Normal release work must not use that
override.

## Runtime Entry

Claude Code discovers `/specnav-verification` and its `/specnav-verify` alias.
Both resolve installed plugin roots, validate the development handoff, and
delegate to:

```bash
node "$SPECNAV_VERIFICATION_ROOT/scripts/claude-verification-adapter.js" \
  validate \
  --project "$PWD" \
  --json
```

The adapter:

- exposes Kernel version, API version, contract digest, six domains, actions,
  skills, and report paths;
- requires explicit approval for runtime installation/repair and state-changing
  V1/V2 artifact conversion;
- blocks light, compact, simplified, fallback, partial-domain, and manual-green
  requests;
- preserves exact blocker ids and affected artifact paths;
- requires every shared source command to attest `fallback_used: false`.

## Verification

```bash
bash tests/run-verification-v2-claude-adapter.sh
bash /Volumes/zwl/AI/ai-coding/specnav-claude-plugin/tests/run-smoke.sh
```

HTML is a projection only. Release and archive gates continue to read the
machine JSON and JSONL artifacts produced by the shared Kernel.
