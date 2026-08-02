# Spec Review: 020-retest-regression-loop

## Verdict

approved

## Missing Requirements

- No Task 020 requirement is missing.

## Extra Behavior

- No behavior was added outside the repair, retry, retest, regression, and
  transition-proposal contract.

## Misunderstood Requirements

- Task 020 proposes lifecycle transitions but does not execute Core-owned close,
  reopen, or break-loop state changes.

## Cannot Verify From Diff

- Host-specific trust and rerun-scope adapters remain owned by Tasks 028-030;
  Task 020 verifies only the host-neutral Kernel contract.

## Requirements Verified

- Immutable history preserves first failure, retry, repair, retest, and
  regression attempts without overwriting evidence.
- Unchanged-fingerprint retry pass is `FLAKY`.
- Reviewed repair followed by a fresh passing retest is `PASS AFTER FIX`.
- Closure is only proposed after the independent Task 022 authority confirms
  the exact repaired, impacted, and baseline scope and every required case has
  fresh, intact passing evidence.
- Failed, blocked, stale, tampered, foreign-context, or unplanned regression
  facts propose reopen or fail closed.
- No-progress produces a Core-owned break-loop proposal, not a Kernel
  transition.

## Acceptance Assertions Verified

- Direct: `AC-06`, `AC-07`, `AC-27`
- Consumption regression: `AC-15`, `AC-26`

## Ownership

- Task 004 retains retry fingerprint ownership for `AC-15`.
- Task 022 retains concrete rerun scope ownership for `AC-26`.
- Core retains close, reopen, and break-loop transition authority.

## Evidence

- `development/evidence/300-020-retest-regression-loop-spec-review-not-approved.md`
- `development/evidence/303-020-retest-regression-loop-spec-review-approved.md`
- `tests/verification-v2/repair-loop/state-machine.test.js`

## Required Fixes

- No required specification fix remains.
