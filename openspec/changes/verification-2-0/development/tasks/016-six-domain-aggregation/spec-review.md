# Spec Review: 016-six-domain-aggregation

## Verdict

approved

## Missing Requirements

- No requirement is missing from the narrowed Task 016 slice.

## Extra Behavior

- No report renderer, archive implementation, host adapter, fallback, or
  simplified verification path was added.

## Misunderstood Requirements

- The original task packet over-attributed complete `AC-28` ownership to this
  aggregation slice. Task 016 contributes the aggregate decision core; Task
  033 retains complete release and archive proof.
- Task 016 consumes `not_applicable` only through an explicit external
  validator. Task 017 retains reason, evidence, reviewer, timestamp, and policy
  approval ownership.

## Cannot Verify From Diff

- Cross-host parity remains Tasks 028 through 031.
- Complete archive gating, report presence, repair-loop closure, and release
  proof remain Task 033.
- Policy-valid `not_applicable` decisions remain Task 017.

## Acceptance Assertions Verified

- `AC-03`
- `AC-18`
- `AC-19`
- `AC-21`

## Verified Behavior

- Verification always requires facticity, static, unit, redteam, E2E, and
  sensory outcomes; light, compact, simplified, and fallback verification
  requests block.
- Manually authored green fields, empty evidence, missing evidence, broken
  integrity, mismatched evidence identity, and caller-authored aggregates
  cannot produce green.
- Case, domain, and release states derive from schema-valid Readings bound to
  intact fresh evidence.
- Every approved case receives all six terminal domain states or remains
  blocked.
- A real failed Reading is not overwritten by stale or canceled metadata.
- `not_applicable` is rejected unless an explicit external authority validates
  the decision.

## Required Fixes

- No further specification fix is required for Task 016.
