# Spec Review: 022-case-rerun-impact

## Verdict

approved

## Missing Requirements

- The reviewed Task 022 slice has no missing requirement.

## Extra Behavior

- No retest execution, regression attempt creation, failure closure, aggregate
  verdict, release, archive, fallback, or simplified verification mode was
  added.

## Misunderstood Requirements

- The initial implementation trusted unbound CodeGraph impact and a snapshot
  without revalidating current human approval. Both defects were repaired and
  remain preserved as failed review evidence.

## Cannot Verify From Diff

- Retest and regression execution remain Task 020.
- Final release and archive gate composition remains Task 033.

## Acceptance Assertions Verified

- AC-24
- AC-26

## Verified Behavior

- Rerun scope returns deterministic concrete case ids with per-case reasons,
  while domain names remain compatibility metadata only.
- Repaired cases, directly impacted cases, stale cases, and mandatory policy
  baselines are retained in the required scope.
- CodeGraph may add evidence-backed impact but cannot remove repaired or
  baseline cases.
- Missing approval, freshness, traceability, or policy inputs fail closed.
- Malformed, cross-change, unbound, or unmapped CodeGraph evidence cannot
  silently narrow the required cases.
- The CLI revalidates the approved snapshot against current requirements,
  current acceptance, and the authenticated reviewer identity.

## Required Fixes

- No further specification fix is required for Task 022.
