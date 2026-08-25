## Context

The failure classifier preserves an immutable failure packet and emits a
signed classification envelope. The repair loop normally derives an
`attempt_fact` by reading the original attempt `integrity.json`. That derivation
is correct while the immutable run tree exists, but it blocks before the state
machine when the run tree has been lost.

A classification envelope proves classification lineage. It does not prove
that missing evidence remains intact and must not be used as a substitute for
an attempt integrity record.

## Goals / Non-Goals

**Goals:**

- Represent a reviewed, byte-for-byte unrecoverable history loss as a distinct
  signed authority fact.
- Preserve all existing failure, classification, and authority history.
- Allow only Core-owned `route_break_loop` handling for the affected failure.
- Keep approval, append-only chaining, exact bindings, and replay safety.

**Non-Goals:**

- Do not reconstruct `run.json`, `attempt.json`, `integrity.json`, readings,
  evidence, events, states, assertions, or runner artifacts.
- Do not infer `evidence-integrity:verified`.
- Do not create an `attempt_fact` for an attempt whose integrity artifact is
  unavailable.
- Do not close, reopen, retry, repair, retest, or regress a failure through the
  artifact-loss authority path.
- Do not change Playwright network or browser execution policy.

## Decisions

1. Add `historical-artifact-loss-review` as the human input contract and
   `historical-artifact-loss` as the Runtime-derived authority payload.
2. Require the review to bind the signed classification envelope digest, the
   recovery audit path and byte digest, and the exact missing artifact paths.
3. Record the authority through an approval-required host action. The action
   blocks if any declared missing artifact currently exists, any path escapes
   the exact historical run/attempt tree, or the audit/classification binding
   differs.
4. Persist authority in a per-failure append-only JSONL chain. Replays return
   the original envelope; conflicting reviews block.
5. Evaluate artifact loss before reading historical run/attempt artifacts.
   The state machine accepts this path only with empty run, attempt, and
   attempt-fact inputs and without repair or rerun authority.
6. The only proposal is `route_break_loop`, owned by Core, with explicit
   `historical-artifact-loss:*` reason ids.
7. Applying the proposal remains a separate approval-required transition.

## Risks / Trade-offs

- Break-loop routing does not make Verification green. The failure remains an
  auditable unresolved historical incident until the separate Core transition
  is approved and applied.
- A supplied original backup makes the artifact-loss review invalid because
  the declared files are no longer missing. Normal integrity evaluation must
  then resume.
- The new trusted fact deliberately makes no claim about historical evidence
  integrity, freshness, or verdict.

## Migration Plan

No historical artifact migration is allowed or required. Existing projects may
append the new authority fact only after a matching human review and recovery
audit are present.

Rollback reverts the Runtime source commit. Existing signed artifact-loss facts
remain immutable audit records and are not deleted.
