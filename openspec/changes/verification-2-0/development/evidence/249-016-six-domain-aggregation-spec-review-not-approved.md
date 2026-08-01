# Independent Spec Review: 016-six-domain-aggregation

## Verdict

blocked

## Findings

- Task report, specification review, and quality review were still scaffolds.
- Acceptance ownership had not formally separated direct aggregation claims
  from downstream `not_applicable`, cross-host, release, and archive closure.
- The light-change artifact path incorrectly pointed into `verify/` instead of
  the change root.

## Required Repairs

- Replace lifecycle scaffolds only after implementation and final reviews pass.
- Bind Task 016 directly to `AC-03`, `AC-18`, `AC-19`, and `AC-21`; retain
  `AC-28` as a downstream contribution owned finally by Task 033.
- Retain Task 017 ownership of complete `not_applicable` approval validation.
- Return the exact root-relative path for `light-change.json`.

## Evidence

The reviewer executed the focused aggregation, package-boundary, no-light,
light-change, and compact-gate fixtures successfully. The review remained
blocked on lifecycle ownership and artifact accuracy.
