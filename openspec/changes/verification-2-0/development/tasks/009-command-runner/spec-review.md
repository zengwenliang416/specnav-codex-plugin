# Spec Review: 009-command-runner

## Verdict

approved

## Scope Decision

Task 009 remains scoped to `AC-14`. The final stability repair only makes the
timeout-before-abort regression deterministic; it does not change the command
runner contract or claim downstream evidence ownership.

## Missing Requirements

- No requirement is missing from the Task 009 `AC-14` command-runner boundary.
  Persistent evidence and derived verdicts remain assigned to later tasks.

## Extra Behavior

- No material extra behavior was found. Process lifecycle hardening, immutable
  stop-cause handling, and blocked artifact preservation directly support the
  approved command execution contract.

## Misunderstood Requirements

- No current requirement misunderstanding remains. The runner emits execution
  facts and raw artifacts but does not claim EvidenceStore or verdict ownership.

## Cannot Verify From Diff

- Long-term evidence retention cannot be verified from Task 009 because it is
  owned by Task 012.
- Reading and six-domain verdict derivation cannot be verified from Task 009
  because they are owned by Tasks 015 and 016.

## AC-14 Verification

- Approval, runtime readiness, exact command identity, run/snapshot binding,
  and retry/cross-reference identity all fail closed before spawn.
- Attempt identity binds change, case, run, attempt, code SHA, test SHA,
  scenario, environment, browser project, and test-data snapshot.
- Command identity binds exact argv, project-relative cwd, canonical
  containment, and the approved environment key set.
- Blocked terminal paths preserve raw logs, ordered events, and original
  execution blockers.
- Double terminal rejection returns no fake run or attempt artifact and marks
  terminal events with `artifact_valid: false`.
- The first successful stop reason is immutable, so timeout followed by abort
  remains a timeout failure.

## Evidence Reviewed

- `066` preserves the original command-runner RED baseline.
- `072`, `079`, `085`, `091`, and `097` preserve independent review failures.
- `073`, `079`, `085`, `091`, and `097` preserve repair-driving RED runs.
- `098` proves the final timeout-before-abort test in five isolated reruns.
- `099` through `103` prove the focused suite, full regression, both plugin
  fixture suites, and static checks after the final repair.

## Live Validation

- Isolated timeout-before-abort repeat: 5/5 passed.
- Focused command-runner suite: 29/29 passed.
- Full Verification V2 suite: 195/195 passed.
- Verification and development plugin fixtures: passed.
- Static syntax and diff checks: passed.

## Acceptance Assertions Verified

- `AC-14`: approved command-backed cases execute through exact argv, cwd,
  environment, runtime, identity, lifecycle, timeout, cancellation, and
  terminal-artifact contracts without shell or fallback execution.

## Findings

- No blocking specification finding remains after the deterministic
  timeout-before-abort repair and independent regression runs.

## Required Fixes

- No further specification fix is required for Task 009 inside the approved
  `AC-14` boundary.
