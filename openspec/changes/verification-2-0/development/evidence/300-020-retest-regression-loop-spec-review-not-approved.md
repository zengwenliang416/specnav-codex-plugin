# Task 020 Specification Review: NOT APPROVED

## Blocking Finding

`validateRerunPlan()` accepted `required_cases` as a superset of the repaired,
impacted, and policy baseline sets. A caller could add unrelated cases and Task
020 would no longer consume Task 022's exact scope.

## Required Fix

- Require exact set equality between `required_cases` and the unique union of
  `repaired_cases`, `impacted_cases`, and `baseline_cases`.
- Reject regression attempts outside the trusted Task 022 scope.
- Add a negative test that supplies an unrelated required case and proves the
  loop fails closed.

## Disposition

Preserved as failed review evidence. A fresh independent specification review is
required after the fix.
