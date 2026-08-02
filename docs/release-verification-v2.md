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

Release and archive proof additionally require `python3`. SpecNav uses a
descriptor-relative filesystem helper (`dir_fd`/`openat` with
`O_NOFOLLOW`) for evidence reads, proof writes, transaction snapshots, and
rollback. If Python is unavailable, the action blocks with
`verification-operations:safe-fs-python-unavailable`; there is no path-based
fallback.

Operations treats persisted Kernel decisions as untrusted release artifacts.
It loads the complete gate input, reruns the public Kernel six-domain
aggregator and DecisionEngine for both `release` and `archive`, and requires
the recomputed identities and decisions to match the persisted gates. It does
not edit Readings, own verdict semantics, or infer PASS from Markdown or HTML.

The persisted runtime status is also untrusted. Release proof resolves the
managed runtime again and verifies the install receipt, runtime lock, package
lock, complete `node_modules` tree through `module_tree_sha256`, Kernel
contract digest, and every managed browser executable through
`executable_sha256`.

Cross-host compatibility is re-established from live repositories. Each
Codex, Claude Code, and CodeFree-O checkout must have the lock-bound Git
`HEAD`, a clean worktree, and a current compatibility snapshot of its plugin
tree, manifest, Skills, and host wrappers. Persisted green receipts,
compatibility JSON, or gates cannot override a red live runtime or host
authority.

## Required Artifacts

For `openspec/changes/<change>/`, release and archive require:

```text
verify/
  evidence/
    raw.jsonl
    index.json
  v2/
    runtime-status.json
    requirements-source.json
    acceptance-source.json
    case-snapshot.json
    case-approval.json
    integrity.json
    gate-input.json
    release-gate.json
    archive-gate.json
    report-model.json
    migration-status.json
  runs/
    <run-id>/
      integrity.json
      attempts/
        <attempt-id>/
          integrity.json
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

The normalized requirements and acceptance source files are independently
hashed into the immutable case snapshot. `case-approval.json` must bind that
exact snapshot and an external human reviewer identity that matches the
reviewer supplied to execution. Service-authored, stale, or mismatched
approvals block.

Production execution itself requires the registered active change and a clean
Git `HEAD`. Project-owned scenario code is accepted only from a regular,
non-symlinked `tests/specnav/*.js` or `tests/specnav/*.cjs` file whose bytes
match `git show HEAD:<path>`. Its top-level module is loaded in an isolated Node
permission process with no write, network, or subprocess capability.

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

The proof fails closed when a case is unapproved, the gate input is incomplete,
Kernel recomputation differs from a persisted gate, a gate identity or source
binding changes, evidence is missing or stale, repairs remain open, migration
proof is incomplete, one host receipt is missing or tampered, cross-host
compatibility is blocked, or any of the three HTML projections is absent.

Attempt integrity is immutable at
`verify/runs/<run-id>/attempts/<attempt-id>/integrity.json`. Run integrity
aggregates every attempt, including earlier failures, and final
`verify/v2/integrity.json` is derived from the complete run history. A later
retry, retest, or regenerated summary cannot erase a red attempt.

Every host installation receipt and the cross-host compatibility result bind
the current change id, release gate id, archive gate id, gate-input SHA-256,
and evidence-index digest. A receipt from an older gate input cannot be reused
even when the host commit is unchanged.

HTML is required for human review, but its text never supplies the verdict.

## Operations And Archive

`operations-gate.js` invokes the V2 proof before release readiness can become
green. `archive-gate.js` uses the same result and records the proof id in the
operations archive gate.

`archive-change.js` snapshots the source change, `openspec/specs`, registry,
active-change, events log, and archive directory set before invoking OpenSpec.
It accepts exactly one new contained archive directory and compares SHA-256
digests for raw evidence and evidence indexes before and after the move.
Archive never rewrites those files.

Every archive read and write rejects ancestor symlinks and uses no-follow
descriptor-relative operations. The action also owns an exclusive
`openspec/.specnav/archive.lock`; an existing lock blocks instead of being
silently replaced. If OpenSpec fails, evidence mutates, archive discovery is
ambiguous or unsafe, or metadata/receipt commit fails, the transaction removes
only newly created archive outputs, restores the complete pre-archive source,
restores only the spec targets owned by the current change, and restores the
registry, active-change, and events state. Unrelated spec paths are preserved.

There is no bypass. Resolve the reported blocker and regenerate the owning
Kernel artifact.
