# Task 022 Spec Review: Needs Fix

## Verdict

needs-fix

## Findings

- CodeGraph impact initially accepted empty evidence references, allowing an
  unproven impact claim to narrow case scope.
- The rerun CLI initially consumed a case snapshot without revalidating the
  exact human approval, current requirements, current acceptance, and reviewer
  identity.

## Resolution

- Impact reports now require source evidence ids, bound per-file evidence
  references, matching change identity, and nonempty top-level evidence refs.
- `rerun-scope.js` now runs the Task 005 case approval validator before any
  scope selection.

## Acceptance Assertions Reviewed

- AC-24
- AC-26
