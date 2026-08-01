# Independent Specification Review: 023-report-model

## Verdict

NOT_APPROVED

## Blockers

1. Frozen failure packets were projected without verifying their run, case,
   attempt, reading, and evidence references against the approved report
   sources. A completed failure could therefore cite missing history while the
   report still appeared green.
2. Repair links were projected into the global repair summary without requiring
   their `failure_id` to resolve to a verified failure in the same change and
   case. This produced inconsistent summary and per-case history.

## Required Fixes

- Bind every failure packet to the current run, case, attempt, reading, and
  evidence graph.
- Bind every repair link to a verified failure in the same change and preserve
  the resulting case association.
- Fail closed on orphan or cross-context history references.
- Add focused negative tests for missing failure evidence and orphan repairs.

## Acceptance Impact

- `AC-10`: complete immutable result and repair history.
- `AC-11`: one consistent information hierarchy.
- `AC-29`: reports remain a faithful projection of validated source truth.
