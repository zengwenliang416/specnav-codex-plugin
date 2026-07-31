# Task Report: 022-case-rerun-impact

## Status

DONE

## Delivered Slice

Verification operators can derive exact rerun cases and reasons from the
approved case snapshot, live approval, changed files, traceability,
freshness, repair state, mandatory policy baselines, and bound CodeGraph
impact evidence.

## Files Changed

- `plugins/specnav-verification/kernel/repair/**`
- `plugins/specnav-verification/kernel/index.js`
- `plugins/specnav-verification/scripts/rerun-scope.js`
- `plugins/specnav-verification/skills/specnav-verify-rerun/**`
- `plugins/specnav-codegraph/core/codegraph-impact-report.js`
- `plugins/specnav-codegraph/scripts/codegraph-impact.js`
- `plugins/specnav-codegraph/schemas/impact.schema.json`
- `plugins/specnav-codegraph/skills/specnav-codegraph-impact/SKILL.md`
- `tests/verification-v2/rerun/**`
- `tests/verification-v2/kernel/package-boundary.test.js`
- `tests/run-verification-v2-codegraph-rerun.sh`
- Task packet, validation log, ledger, drift record, and append-only evidence

## What Changed

- Added public `createCaseRerunPlanner()` without changing the frozen service
  contract digest.
- Produces deterministic `required_cases`, `cases_to_rerun`, and
  `reasons_by_case` from repaired, impacted, stale, and baseline sources.
- Revalidates the exact human-approved case snapshot against current
  requirements, acceptance, and reviewer identity before selecting scope.
- Expands unmapped production changes to all approved cases.
- Blocks unknown references, malformed artifacts, missing freshness,
  incomplete six-domain assignments, cross-change impact, and unbound
  CodeGraph evidence.
- Added a versioned CodeGraph impact report that binds affected files to
  source evidence ids and persisted evidence references.
- Updated both skills so concrete case ids, not domain-only output, drive
  downstream rerun execution.

## TDD Evidence

- `191-022-case-rerun-impact.log` preserves the missing public API RED run.
- `192-022-case-rerun-impact-spec-review-needs-fix.md` preserves unbound
  CodeGraph evidence and missing approval revalidation findings.
- `193-022-case-rerun-impact-quality-review-needs-fix.md` preserves domain,
  artifact blocker, and blocker-shape findings.
- `192-022-case-rerun-impact.log` records the final focused suite at 20/20.
- `193-022-case-rerun-impact.log` records the CodeGraph and rerun CLI fixture.
- `194-022-case-rerun-impact.log` records the full V2 suite at 331/331.
- `195` through `199` `.log` files record verification, development,
  CodeGraph, runtime, and static validation.

## Verification Commands

- `node --test tests/verification-v2/rerun/*.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `bash tests/run-verification-v2-codegraph-rerun.sh`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `bash tests/run-codegraph-context-fixtures.sh`
- `node plugins/specnav-verification/scripts/verification-runtime.js doctor --version 2.0.0-alpha.1 --project /Volumes/zwl/AI/ai-coding/specnav-codex-plugin --root /Users/wenliang_zeng/.specnav/runtime/verification --json`
- `for file in plugins/specnav-verification/kernel/repair/*.js plugins/specnav-verification/scripts/rerun-scope.js plugins/specnav-codegraph/core/codegraph-impact-report.js plugins/specnav-codegraph/scripts/codegraph-impact.js tests/verification-v2/rerun/*.js; do node --check "$file" || exit 1; done && git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log'`

## Concerns

- Task 020 must execute the returned retest and regression cases and preserve
  attempt history.
- Task 033 must consume the resulting scope and fresh evidence for release and
  archive decisions.
- Runtime doctor retains the existing non-blocking Midscene provider warning.

## Scope Deviations

- The task packet was corrected to allow the public Kernel export, CLI fixture,
  skill updates, and lifecycle evidence required to prove AC-24 and AC-26.
- CodeGraph impact artifact projection was added because case-level rerun scope
  cannot rely on an unstructured operations query result.
- The four CodeGraph runtime JSON files remain excluded from this checkpoint.

## Follow-up Needed

- Task 020 must consume `required_cases` and `reasons_by_case` without
  recomputing or manually shrinking scope.
- Report and gate owners must display and cite the scope, policy, freshness,
  and CodeGraph references.

## Adjudication

Independent specification and quality reviews approved the final live
worktree. Task 022 is complete.
