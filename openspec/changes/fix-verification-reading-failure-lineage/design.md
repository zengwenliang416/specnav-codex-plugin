## Context

The failure classifier accepts only schema-valid `fail` or `blocked` readings,
binds them to the run, case, attempt, evidence, and root-cause review, then
emits a signed classification envelope. The repair-loop state machine verifies
that envelope before loading attempt history.

The current state machine nevertheless requires the initial attempt and its
attempt fact to be failed or blocked. A deterministic reading rejection can
therefore create a valid failure packet for an attempt whose runner status and
attempt fact are both honestly `passed`.

## Goals / Non-Goals

**Goals:**

- Preserve reading-level failure lineage without changing historical facts.
- Continue verifying exact run, case, attempt, fingerprint, envelope, and fact
  bindings.
- Allow the existing repair, retest, regression, and transition machinery to
  evaluate the failure.

**Non-Goals:**

- Do not change how readings or failure packets are created.
- Do not add caller-provided lifecycle state or manual-green behavior.
- Do not change Playwright execution or network security.
- Do not migrate or rewrite existing attempts, failures, readings, or evidence.

## Decisions

1. Treat the trusted classification envelope as the authority for the failure
   source. Its producer, signature, claims, digest, and failure bindings are
   already verified before attempt validation.
2. Permit `passed` as an initial attempt status only for a schema-valid failure
   packet with non-empty reading and failed-assertion bindings. The matching
   attempt fact must remain `pass`.
3. Keep attempt facts tied to runner terminal status. A caller cannot change a
   passed attempt fact to `fail` to manufacture failure lineage.
4. Preserve the existing repair-loop request shape. Passing raw readings into
   the state machine would duplicate classifier validation and create a second
   authority path.

## Risks / Trade-offs

- A passed attempt can now be the root of a repair loop. This is intentional
  only because the trusted classifier envelope proves the separate
  reading-level failure.
- The attempt history continues to display the runner result as `PASS`; the
  failure packet remains the separate authority for the reading failure.
- The installed plugin cache is not modified. The source fix must be released
  or installed through the normal plugin delivery path before other worktrees
  consume it.

## Migration Plan

No artifact migration is required. Existing immutable failure histories become
evaluable when run against the corrected Runtime source.

Rollback is the single source commit revert; no data rollback is needed.

## Open Questions

None.
