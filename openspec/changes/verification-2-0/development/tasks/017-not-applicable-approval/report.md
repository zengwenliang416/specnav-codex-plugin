# Task Report: 017-not-applicable-approval

## Status

DONE

## Files Changed

- `plugins/specnav-verification/kernel/evaluation/not-applicable-validator.js`
- Kernel evaluation and public exports
- Focused evaluation and package-boundary tests
- Task packet, task graph, context, ledger, validation log, and append-only
  evidence

## What Changed

- Added a host-neutral not-applicable decision authority.
- Required a schema-valid current test case whose selected domain explicitly
  uses `not_applicable`.
- Required the configured human reviewer, active policy allowance, explicit
  RFC3339 approval/policy timing, and non-expired policy state.
- Required evidence to exist before approval and bind to the same change, case,
  domain, assertion, and unique owning step.
- Required Task 013 integrity facts to prove evidence is intact and fresh.
- Bound stable facts to case, policy, and full evidence content digests.
- Snapshotted trusted catalogs at construction to prevent caller mutation and
  TOCTOU changes.
- Exposed the authority through the versioned Kernel and integrated it with
  Task 016 aggregation.

## TDD Evidence

- `255-017-not-applicable-approval.log` preserves the missing implementation and
  export RED state.
- `256-017-not-applicable-approval.log` records the initial focused GREEN.
- `257-017-not-applicable-approval-quality-review-not-approved.md` and
  `258-017-not-applicable-approval-spec-review-not-approved.md` preserve the
  independent review blockers.
- `257-017-not-applicable-approval.log` preserves four reproduced review RED
  cases.
- `258-017-not-applicable-approval.log` proves the repaired focused set at
  `23/23`.
- `259-017-not-applicable-approval-spec-review-approved.md` and
  `260-017-not-applicable-approval-quality-review-approved.md` record final
  independent approvals.
- System receipts `259` through `262` prove the full `386/386` Verification
  2.0 regression, both plugin contracts, lifecycle maintenance, and diff
  checks.
- `263-017-not-applicable-approval.log` and
  `264-017-not-applicable-approval.log` prove the Task 017 lifecycle blocker is
  retired while downstream unfinished-work controls remain active.

## Verification Commands

- `node --test tests/verification-v2/evaluation/not-applicable.test.js tests/verification-v2/evaluation/aggregation.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `bash tests/run-verification-v2-development-contract-maintenance.sh`
- `git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log' ':(exclude)openspec/changes/verification-2-0/codegraph/*.json'`

## Concerns

- Tasks 028 through 031 must integrate the shared Kernel contract across all
  three hosts.
- Task 033 retains complete release and archive proof.

## Scope Deviations

- The task scope was corrected to include the Kernel export,
  package-boundary assertion, task graph, and lifecycle artifacts.
- Direct acceptance ownership was narrowed to `AC-20`; Task 017 contributes
  only the validated `not_applicable` branch to `AC-19`.
- The four pre-existing CodeGraph runtime JSON files remain outside this task.

## Follow-up Needed

- Task 018 continues the Failure Repair Loop with authoritative failure
  classification.

## Adjudication

Both original RED paths and independent blocked reviews remain append-only.
Exact later system receipts and final independent re-reviews prove the repairs
without erasing failed evidence. No fallback or simplified verification path
was introduced. Completed-state lifecycle checks leave 50 legitimate
downstream blockers active.
