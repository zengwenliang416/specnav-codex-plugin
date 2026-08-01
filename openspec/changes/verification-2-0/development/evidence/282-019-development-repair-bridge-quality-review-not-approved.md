# Quality Review Evidence: 019-development-repair-bridge

## Verdict

blocked

## Findings

1. Caller-authored `break_loop_required` signals could pass shape checks and be
   forwarded without trusted provenance.
2. Scope validation rejected traversal but did not reject overlapping
   allow/deny glob roots or review paths outside the allowed scope.
3. The repair packet needed a standard `NNN-kebab-case` task id, explicit
   packet path, and scope digest to make the Development handoff concrete.
4. Task report and final review artifacts remained scaffolds, as expected
   before repair and re-review.

## Required Fixes

- Forbid signal forwarding in Task 019. Task 020/Core retain break-loop
  authority and consume Task 018 evidence directly.
- Fail closed on overlapping allow/deny patterns, review paths outside allow,
  and review paths overlapping deny.
- Emit a standard task id, task packet path, scope source, and scope digest.
- Add adversarial regressions and rerun independent reviews.

This review is preserved as append-only RED evidence.
