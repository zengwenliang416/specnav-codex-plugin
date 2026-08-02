# Verification 2.0 Release And Archive Proof

Verification 2.0 is mandatory for every release and archive lane. It has no
light, compact, partial-domain, fallback, or manual-green mode.

## Authority Boundary

The Verification Kernel owns:

- six-domain aggregation;
- release and archive gate decisions;
- gate identity;
- evidence integrity and freshness;
- report-model semantics.

Operations consumes persisted Kernel decisions and source artifacts. It does
not edit Readings, recalculate domain verdicts, or infer PASS from Markdown or
HTML.

## Required Artifacts

For `openspec/changes/<change>/`, release and archive require:

```text
verify/
  evidence/
    raw.jsonl
    index.json
  v2/
    runtime-status.json
    case-snapshot.json
    case-approval.json
    gate-input.json
    release-gate.json
    archive-gate.json
    report-model.json
    migration-status.json
  reports/
    overview.html
    test-case-catalog.html
    test-case-results.html
operations/
  host-installation-receipts.json
  install-receipts/
    claude-code.json
    codex.json
    codefree-o.json
  cross-host-compatibility.json
  verification-v2-proof.json
```

When migration is required, `migration-status.json` must reference a
schema-valid apply receipt with successful validation and an available
rollback.

## Validation

Run the focused proof:

```bash
node plugins/specnav-operations/scripts/verification-v2-proof.js \
  --change <change> \
  --json
```

Run the release regression suite:

```bash
bash tests/run-verification-v2-release.sh
```

The proof fails closed when a case is unapproved, a gate identity or source
binding changes, evidence is missing or stale, repairs remain open, migration
proof is incomplete, one host receipt is missing or tampered, cross-host
compatibility is blocked, or any of the three HTML projections is absent.

HTML is required for human review, but its text never supplies the verdict.

## Operations And Archive

`operations-gate.js` invokes the V2 proof before release readiness can become
green. `archive-gate.js` uses the same result and records the proof id in the
operations archive gate.

`archive-change.js` snapshots the archive directory set before invoking
OpenSpec and accepts exactly one new archive directory. It compares SHA-256
digests for raw evidence and evidence indexes before and after the move.
Archive never rewrites those files.

There is no bypass. Resolve the reported blocker and regenerate the owning
Kernel artifact.
