# Spec Review: 021-case-freshness

## Verdict

approved

## Missing Requirements

- The reviewed Task 021 slice has no missing requirement.

## Extra Behavior

- No rerun-scope selection, baseline policy, CodeGraph impact, report model,
  gate decision, release, archive, fallback, or simplified mode was added.

## Misunderstood Requirements

- Earlier implementations allowed incomplete source identity and implicit
  sequence coercion. Those defects were repaired and retained as RED evidence.

## Cannot Verify From Diff

- Concrete impacted-case selection remains Task 022.
- Gate-decision composition remains Task 033.

## Acceptance Assertions Verified

- `AC-17:stale-sha`
- `AC-23`
- `AC-35:freshness-result-source`

## Verified Behavior

- Every approved case receives a deterministic freshness fact.
- Eight explicit fingerprints are compared; mtime is ignored.
- Latest attempt selection is bound to run, change, case, stable identity, and
  a positive integer sequence.
- Missing, conflicting, ambiguous, foreign, or hostile sources cannot produce
  fresh.
- The evaluator returns freshness facts and blockers only.

## Required Fixes

- No further specification fix is required for Task 021.
