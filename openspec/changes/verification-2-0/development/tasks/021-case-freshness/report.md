# Task Report: 021-case-freshness

## Status

DONE

## Delivered Slice

Reviewers can inspect deterministic freshness for every approved case using
case snapshot, code, test, environment, runtime, kernel, browser, and test-data
fingerprints. Mtime alone cannot produce fresh.

## Files Changed

- `plugins/specnav-verification/kernel/evidence/**`
- `plugins/specnav-verification/kernel/index.js`
- `tests/verification-v2/freshness/**`
- `tests/verification-v2/kernel/package-boundary.test.js`
- Task packet, validation log, ledger, drift record, and append-only evidence

## What Changed

- Added public `createCaseFreshnessEvaluator()` without changing the frozen
  service contract digest.
- Extracted one immutable fingerprint comparator reused by evidence integrity
  and case freshness.
- Added per-case `fresh`, `stale`, or `unknown` facts with exact stale or
  missing reasons and stable blockers.
- Kept run-level identity authoritative while using browser and test-data
  fingerprints from the selected case attempt.
- Selected only the latest positive-integer sequence bound to the active run,
  change, and case.
- Blocked empty snapshots, missing identities, missing source/current
  fingerprints, snapshot/run mismatch, run/attempt mismatch, ambiguous
  attempts, foreign attempts, and hostile input.
- Kept rerun-scope selection outside this task.

## TDD Evidence

- `180-021-case-freshness.log` preserves the missing public API RED run.
- `181-021-case-freshness.log` preserves snapshot/run, ambiguous-attempt, and
  empty-snapshot RED cases.
- `182-021-case-freshness.log` and its failed quality review preserve the
  frozen-array, foreign-run, and run-source defects.
- `183-021-case-freshness.log` and the incomplete spec review preserve identity
  binding defects and the interrupted review.
- `184-021-case-freshness.log` and its failed quality review preserve sequence
  coercion.
- `185-021-case-freshness.log` records the final focused suite at 55/55.
- `186-021-case-freshness.log` records the full V2 suite at 315/315.
- `187` through `190` `.log` files record both plugin fixtures, runtime
  readiness, and static checks.

## Verification Commands

- `node --test tests/verification-v2/freshness/freshness.test.js tests/verification-v2/evidence/integrity.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `node plugins/specnav-verification/scripts/verification-runtime.js doctor --version 2.0.0-alpha.1 --project /Volumes/zwl/AI/ai-coding/specnav-codex-plugin --root /Users/wenliang_zeng/.specnav/runtime/verification --json`
- `for file in plugins/specnav-verification/kernel/evidence/*.js tests/verification-v2/freshness/*.js tests/verification-v2/evidence/integrity.test.js tests/verification-v2/kernel/package-boundary.test.js; do node --check "$file" || exit 1; done && git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log'`

## Concerns

- Task 022 still owns concrete rerun-case selection and impact reasons.
- Task 033 still owns final gate decisions and must consume this freshness
  result rather than recomputing it.
- Runtime doctor retains the existing non-blocking Midscene provider warning.

## Scope Deviations

- The task packet was corrected to allow the public Kernel export,
  package-boundary test, and lifecycle evidence required for AC-23.
- No change was made to `rerun-scope.js`; rerun selection remains Task 022.
- The four CodeGraph runtime JSON files remain excluded from this checkpoint.

## Follow-up Needed

- Task 022 must combine case freshness with traceability and policy-required
  baseline cases.
- Report and gate owners must display and cite these case freshness facts.

## Adjudication

Independent specification and quality reviews approved the final live
worktree. Task 021 is complete.
