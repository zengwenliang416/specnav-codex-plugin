# Spec Review: 015-reading-model

## Verdict

approved

## Missing Requirements

- No requirement is missing from the narrowed Task 015 slice.

## Extra Behavior

- No six-domain aggregate, not-applicable approval, report model, release
  decision, archive gate, fallback, or simplified verification path was added.

## Misunderstood Requirements

- The original task packet over-attributed AC-19, AC-21, and AC-31 to the
  Reading slice. The corrected task graph directly closes only AC-16.
- Task 015 contributes validated Reading inputs to AC-19, AC-21, and AC-31;
  Tasks 016, 017, and the evidence-contract tasks retain final closure.

## Cannot Verify From Diff

- Six terminal domain results for every approved case remain Task 016 and
  Task 017.
- Domain and release verdict derivation remains Task 016 and the later release
  gate tasks.
- Full evidence-record production remains the evidence store and integrity
  task boundary.

## Acceptance Assertions Verified

- `AC-16`

## Verified Behavior

- Midscene observations cannot produce PASS without a deterministic fact or
  valid explicit human signoff.
- Every required domain/assertion pair receives a stable schema-valid Reading
  containing expected, actual, oracle, evidence ids, source SHAs, and complete
  execution identity.
- Deterministic assertion status is recomputed instead of trusted.
- Missing, stale, broken, wrongly bound, or wrong-kind evidence blocks the
  associated Reading.
- Run-owned attempt fingerprints and terminal case status are checked before a
  Reading set can be accepted.
- A mixed-result case preserves both pass and fail Readings while producing a
  failed case result; a passing case may remain valid inside a failed
  multi-case run.

## Required Fixes

- No further specification fix is required for Task 015.
