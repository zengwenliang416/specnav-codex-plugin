# Task Report: 023-report-model

## Status

DONE

## Delivered Slice

Stakeholders can receive one validated, immutable report model that projects
the complete case, execution, evidence, failure, repair, freshness, aggregate,
and release-gate history for all three report pages.

## Files Changed

- `plugins/specnav-verification/kernel/reporting/**`
- `plugins/specnav-verification/kernel/index.js`
- `plugins/specnav-verification/schemas/report-model.schema.json`
- `tests/verification-v2/contracts/fixtures/positive/report-model.json`
- `tests/verification-v2/kernel/package-boundary.test.js`
- `tests/verification-v2/reports/**`
- `tests/run-verification-v2-report-model.sh`
- Task packet, ledger, validation log, and append-only evidence

## What Changed

- Added one deterministic report model and schema for overview, catalog, and
  result renderers.
- Derives green, red, blocked, running, canceled, stale, flaky, and
  pass-after-fix states without accepting caller-authored summary state.
- Recomputes aggregate and gate state through injected authorities.
- Verifies exact Evidence Index raw bytes, integrity and freshness receipts,
  complete cross references, source bindings, and immutable history.
- Resolves only controlled evidence paths and redacts command metadata.
- Requires completed repairs to bind successful post-fix review evidence to
  the same case's retest or regression chain.

## TDD Evidence

- `307` through `309` preserve initial and review-triggered RED runs.
- `308`, `310`, and `318` preserve failed quality reviews.
- `309`, `311`, and `319` preserve failed specification reviews.
- `320` preserves the final three focused RED regressions.
- `321` records focused validation at 35/35.
- `322` records the full Verification 2.0 suite at 445/445.
- `323` records both plugin contracts.
- `324` records syntax and diff validation.
- `325` and `326` preserve fresh independent approvals.

## Verification Commands

- `bash tests/run-verification-v2-report-model.sh`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `for file in plugins/specnav-verification/kernel/reporting/*.js tests/verification-v2/reports/*.js; do node --check "$file" || exit 1; done`
- `git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log' ':(exclude)openspec/changes/verification-2-0/codegraph/*.json'`

## Concerns

- Host adapters must provide real authority implementations backed by
  independent source stores.
- HTML rendering and browser behavior remain intentionally deferred to Tasks
  024-026.

## Scope Deviations

- None recorded.

## Follow-up Needed

- Task 024 must consume this model without querying raw source artifacts.
- Tasks 025-026 must reuse the same status vocabulary and controlled links.

## Adjudication

Independent specification and quality reviews approved the final live
worktree. Task 023 is complete.
