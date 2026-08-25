## Context

The current artifact pipeline loads lifetime projections from `verify/v2` and
rebuilds a single failure state. This is correct for one generation, but it
cannot distinguish an immutable historical incident from the executions that
are intended to prove a later approved baseline.

Timestamp slicing is insufficient because clocks are not an authority and
because existing projection arrays are derived files whose ordering may
change. Generation membership therefore must be explicit.

## Goals / Non-Goals

**Goals:**

- Require an exact human-approved generation review before activation.
- Freeze every pre-generation record by id and canonical digest.
- Bind all post-activation runs to one signed active generation.
- Scope current Gate inputs to that generation while preserving lifetime
  history for audit and disclosure.
- Fail closed on missing, forged, stale, conflicting, or drifted generation
  authority.

**Non-Goals:**

- Do not close, supersede, delete, rewrite, reconstruct, or regenerate prior
  failures, attempts, readings, evidence, or execution directories.
- Do not use timestamps alone to infer generation membership.
- Do not allow a passing successor generation to claim prior incidents passed.
- Do not relax Playwright network safety.

## Decisions

1. `verification-generation-review` is the exact approval payload. It binds the
   change, reviewer, snapshot, fingerprints, parent generation, historical
   `break_loop` ids, and frozen baseline inventory.
2. `verification-generation` is the Runtime-signed activation record. Records
   form an append-only HMAC chain in `verify/v2/generations.jsonl`.
3. A baseline inventory stores the canonical digest of every existing record
   in the authoritative projections and logs. Activation and later use require
   every baseline record to remain byte-semantically identical.
4. New `verification-run` records carry `generation_id`. Legacy runs remain
   schema-valid but cannot enter an active generation Gate.
5. Initial, retry, retest, and regression execution must use the active
   generation. A retry cannot append to a run from another generation.
6. Finalization filters runs by `generation_id`, then derives attempts,
   readings, evidence, failures, repairs, integrity, freshness, and reports
   from that run set.
7. Historical open failures excluded from the active generation become stable
   report warnings. They are never current Gate blockers and are never
   represented as passed.
8. Generation preparation is read-only except for an immutable review artifact.
   Activation requires the host `--approved` boundary.

## Risks / Trade-offs

- Every source, test, runtime, environment, Kernel, snapshot, or frozen
  baseline change invalidates the prepared review and requires a new review.
- A successor generation must re-run all approved cases; pre-activation passing
  executions cannot be reused.
- Reports focus on the active generation and expose prior incidents as warnings
  rather than embedding all prior run detail in current case results.

## Migration Plan

No historical migration is performed. Projects without an active generation
remain blocked for execution and finalization until a review is prepared,
explicitly approved, and activated.

Rollback reverts Runtime source. Existing generation reviews and signed
activation records remain append-only audit artifacts and are not deleted.
