# Task Report: 015-reading-model

## Status

DONE

## Delivered Slice

Reviewers can inspect one schema-valid Reading for every required
domain/assertion pair. Each Reading carries expected value, actual value,
normalized oracle identity, evidence ids, verdict, source SHAs, and complete
change/run/case/attempt/step/assertion identity.

## Files Changed

- `plugins/specnav-verification/kernel/evaluation/**`
- `plugins/specnav-verification/kernel/index.js`
- `tests/verification-v2/evaluation/**`
- `tests/verification-v2/kernel/package-boundary.test.js`
- Task packet, task context, ledger, validation log, and append-only evidence

## What Changed

- Added a host-neutral oracle registry for deterministic facts and explicitly
  approved human signoff.
- Added a Reading evaluator that creates stable, schema-validated readings for
  every required domain and assertion.
- Bound evidence by change, run, case, attempt, step, assertion, code SHA, test
  SHA, and allowed evidence kind.
- Required intact, fresh, present, hash-matching, size-matching, recognized,
  store-backed, path-safe evidence before a Reading can be green.
- Recomputed deterministic assertions instead of trusting runner status text.
- Kept Midscene observations blocked unless an independent deterministic fact
  or valid human signoff owns the final oracle.
- Added aggregate terminal consistency for multi-assertion cases and preserved
  valid pass readings inside a failed case.
- Allowed a passing case to remain valid when another case causes a multi-case
  run to fail.
- Exported the oracle registry and Reading evaluator through the versioned
  Verification Kernel entry point.

## TDD Evidence

- `232-015-reading-model.log` preserves the pre-implementation RED failure
  where the evaluation module did not exist.
- `233-015-reading-model.log` records the first focused implementation pass and
  exactly supersedes the preserved RED receipt through an explicit
  adjudication.
- `234-015-reading-model.log` records the final focused suite at 13/13 after
  aggregate terminal-status and recursive package-boundary hardening.
- `235-015-reading-model.log` records the pre-review full Verification 2.0
  suite at 365/365.
- `236-015-reading-model.log` records both plugin contract fixtures.
- `237-015-reading-model.log` records the final diff check.
- `238-015-reading-model.log` preserves the independent quality-review RED
  reproduction for incomplete fingerprints and lost schema blockers.
- `239-015-reading-model.log` records the repaired focused suite at 15/15 and
  exactly supersedes receipt `238`.
- `240-015-reading-model-spec-review-not-approved.md` preserves the initial
  specification review blockers.
- `241-015-reading-model-spec-review-approved.md` and
  `242-015-reading-model-quality-review-approved.md` record the final
  independent approvals.
- `240-015-reading-model.log` records the post-review full Verification 2.0
  suite at 367/367.
- `241-015-reading-model.log`, `242-015-reading-model.log`, and
  `243-015-reading-model.log` record final plugin contracts, lifecycle
  maintenance, and diff checks.
- `244-015-reading-model.log` proves every Task 015 lifecycle blocker is
  retired while downstream unfinished-work controls remain active.
- `245-015-reading-model.log` records the completed-state lifecycle
  maintenance and diff check with 56 legitimate downstream blockers.

## Verification Commands

- `node --test tests/verification-v2/evaluation/reading-model.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log' ':(exclude)openspec/changes/verification-2-0/codegraph/*.json'`

## Concerns

- Task 016 still owns six-domain case aggregation and terminal domain results.
- Task 017 still owns `not_applicable` approval.
- Tasks 023 through 026 still own report models and HTML projection.
- Release and archive gates remain downstream and cannot be inferred from a
  green Reading alone.

## Scope Deviations

- The task packet was corrected to include the Kernel public export,
  package-boundary test, task graph, and lifecycle artifacts required to
  deliver and review the slice.
- Direct acceptance ownership was narrowed to AC-16. AC-19, AC-21, and AC-31
  remain explicit contributions with downstream closure.
- The four CodeGraph runtime JSON files remain outside this task.

## Follow-up Needed

- Task 016 must aggregate these Readings into six terminal domain results
  without accepting agent prose or hand-edited domain status.
- Downstream report and gate tasks must consume validated Reading artifacts
  rather than recomputing verdicts.

## Adjudication

The original RED receipt remains append-only and is tied to the first
system-executed GREEN receipt by exact evidence paths. Final focused, full
regression, plugin contract, and diff checks all passed after the last code
change. Independent specification and quality reviews are recorded separately,
and completed-state receipts `244` and `245` prove lifecycle closure.
