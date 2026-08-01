# Task Report: 016-six-domain-aggregation

## Status

DONE

## Files Changed

- `plugins/specnav-verification/kernel/evaluation/**`
- `plugins/specnav-verification/kernel/gates/**`
- `plugins/specnav-verification/kernel/index.js`
- `plugins/specnav-verification/scripts/verify-domains.js`
- `tests/verification-v2/evaluation/**`
- `tests/verification-v2/kernel/package-boundary.test.js`
- No-light and legacy light fixture scripts
- Task packet, task graph, context, ledger, validation log, and append-only
  evidence

## What Changed

- Added a host-neutral six-domain aggregator that derives case, domain, and
  release states from schema-valid Readings bound to intact fresh evidence.
- Added a DecisionEngine that recomputes aggregation from source input and
  blocks non-pass aggregates, stale evidence, broken integrity, and open
  failures.
- Added explicit `not_applicable` authority injection; absent or rejected
  authority blocks.
- Added a shared terminal-state lattice distinguishing pass, fail, blocked,
  flaky, pass-after-fix, stale, canceled, and not-applicable.
- Removed the verification light lane. Light requirements/development changes
  must escalate into the full six-domain contract before release or archive.
- Exported the aggregator, decision engine, and six fixed domains through the
  versioned Kernel entry.

## TDD Evidence

- `246-016-six-domain-aggregation.log` preserves the pre-fix false green where
  static and unit alone released a light change.
- `247-016-six-domain-aggregation.log` records the repaired focused suite at
  25/25.
- `248-016-six-domain-aggregation.log` records the no-light and legacy fixture
  regression and exactly supersedes receipt `246`.
- `249-016-six-domain-aggregation-spec-review-not-approved.md` and
  `250-016-six-domain-aggregation-quality-review-not-approved.md` preserve the
  initial independent review blockers.
- `251-016-six-domain-aggregation-spec-review-approved.md` and
  `252-016-six-domain-aggregation-quality-review-approved.md` record final
  independent approvals.
- System receipts `249` through `252` record the full 377/377 Verification
  2.0 regression, both plugin contracts, lifecycle maintenance, and diff
  checks.
- `253-016-six-domain-aggregation.log` proves every Task 016 lifecycle blocker
  is retired while downstream unfinished-work controls remain active.
- `254-016-six-domain-aggregation.log` records completed-state lifecycle
  maintenance and diff checks with 53 legitimate downstream blockers.

## Verification Commands

- `node --test tests/verification-v2/evaluation/aggregation.test.js tests/verification-v2/evaluation/reading-model.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `bash tests/run-verification-v2-no-light.sh`
- `bash tests/run-light-change-v2-fixtures.sh`
- `bash tests/run-light-compact-gate-fixtures.sh`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `bash tests/run-verification-v2-development-contract-maintenance.sh`

## Concerns

- Task 017 must implement and validate complete `not_applicable` approval
  records before that state is available in production.
- Tasks 028 through 031 must integrate this Kernel contract across Codex,
  Claude Code, and CodeFree-O.
- Task 033 retains complete release and archive proof.

## Scope Deviations

- The task scope was corrected to include the Kernel public entry,
  package-boundary test, no-light fixtures, task graph, and lifecycle evidence.
- Direct acceptance ownership was narrowed to `AC-03`, `AC-18`, `AC-19`, and
  `AC-21`; `AC-28` remains a downstream contribution.
- The four CodeGraph runtime JSON files remain outside this task.

## Follow-up Needed

- Task 017 must provide the concrete external N/A validator.
- Downstream report, host, release, and archive tasks must consume the public
  Kernel APIs without reimplementing aggregation.

## Adjudication

The original false-green receipt and initial blocked reviews remain
append-only. Exact later system receipts and final independent re-reviews prove
the repairs without erasing failed evidence. Full regression and contract
receipts passed after the final code and review changes, and completed-state
lifecycle receipts prove Task 016 no longer contributes a blocker.
