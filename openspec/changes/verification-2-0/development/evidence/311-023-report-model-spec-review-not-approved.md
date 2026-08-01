# Independent Specification Review: 023-report-model

## Verdict

NOT_APPROVED

## Blockers

1. `pass_after_fix`, `red`, `flaky`, and `stale` verdict selection occurs
   before structural blocker enforcement. A malformed repair history can
   therefore return `ok: true` with source-binding blockers.
2. Gate recomputation selects the latest run by creation time, while summary
   projection selects it by id. A green report can expose runtime and kernel
   versions from an older run while its gate is bound to the actual latest run.

## Required Fixes

- Make structural blockers take precedence over every non-running verdict.
- Make `ok` require both a non-blocked verdict and zero structural blockers.
- Use one chronological run comparator for gate authority, result history, and
  summary projections.
- Repair the pass-after-fix fixture so it represents valid bound history and
  assert both `ok: true` and an empty blocker set.
- Add regressions for blocked pass-after-fix and contradictory run ordering.

## Acceptance Impact

- `AC-08`, `AC-09`, `AC-10`, `AC-11`, and `AC-29`.

## Evidence

- Existing focused tests passed 11/11 and the focused runner passed 21/21.
- Independent read-only reproductions returned `ok: true` with 15 binding
  blockers and returned a green model whose summary versions contradicted its
  gate versions.
