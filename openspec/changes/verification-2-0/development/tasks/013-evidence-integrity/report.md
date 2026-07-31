# Task Report: 013-evidence-integrity

## Status

DONE

## Delivered Slice

Release owners can inspect deterministic integrity and freshness facts for
stored evidence. Missing, tampered, stale, incorrectly bound, unrecognized, or
path-unsafe evidence cannot produce a green integrity result.

## Files Changed

- `plugins/specnav-verification/kernel/evidence/**`
- `plugins/specnav-verification/kernel/index.js`
- `tests/verification-v2/evidence/**`
- `tests/verification-v2/kernel/package-boundary.test.js`
- `tests/run-verification-v2-negative.sh`
- Task packet, validation log, ledger, drift record, and append-only evidence

## What Changed

- Added `createEvidenceIntegrityChecker()` as a public concrete Kernel factory
  without changing the frozen service contract digest.
- Added facts-only integrity output for existence, hash, size, producer,
  stored-record identity, cross-reference binding, path safety, and freshness.
- Added complete freshness comparison for `case_snapshot_hash`, `code_sha`,
  `test_sha`, `environment_hash`, `runtime_version`, and `kernel_version`.
- Preserved distinct blockers for missing object, missing store record, record
  mismatch, identity mismatch, stale evidence, and incomplete fingerprints.
- Made inconsistent or hostile cross-reference collaborator results fail
  closed while preserving supplied root-cause blockers.
- Added root and ancestor revalidation, leaf `O_NOFOLLOW`, and descriptor
  identity checks for raw, index, and object reads.
- Added the exact `resolve()`-then-object-ancestor replacement regression so
  external same-hash bytes cannot manufacture trusted facts.

## TDD Evidence

- `152`, `153`, `157`, `158`, `162`, `164`, and `166` Task 013 Markdown
  evidence files preserve the original RED runs and review-driven failures.
- `156`, `163`, and `165` Markdown evidence files preserve independent
  `NOT APPROVED` reviews.
- `159`, `167`, and `168` Markdown evidence files preserve final approved
  specification, quality, and security reviews.
- `162-013-evidence-integrity.log` records the final focused suite at 57/57.
- `163-013-evidence-integrity.log` records the final negative suite at 28/28.
- `164-013-evidence-integrity.log` records the full V2 suite at 271/271.
- `165` through `168` `.log` files record both plugin fixtures, runtime
  readiness, and static checks.

## Verification Commands

- `node --test tests/verification-v2/evidence/integrity.test.js tests/verification-v2/evidence/evidence-store.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `bash tests/run-verification-v2-negative.sh`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `node plugins/specnav-verification/scripts/verification-runtime.js doctor --version 2.0.0-alpha.1 --project /Volumes/zwl/AI/ai-coding/specnav-codex-plugin --root /Users/wenliang_zeng/.specnav/runtime/verification --json`
- `for file in plugins/specnav-verification/kernel/evidence/*.js tests/verification-v2/evidence/*.js tests/verification-v2/kernel/package-boundary.test.js; do node --check "$file" || exit 1; done && git diff --check`

## Concerns

- Secret redaction remains Task 014.
- Reading verdict ownership remains Task 015.
- Case-level freshness and rerun policy remain Tasks 021 and 022.
- Release and archive enforcement remain Task 033.

## Scope Deviations

- The task packet was corrected to allow the public concrete factory,
  package-boundary test, negative runner, and lifecycle evidence.
- EvidenceStore path-reading hardening was required to make Task 013 integrity
  facts trustworthy. The storage layout and frozen service contract remain
  unchanged.

## Follow-up Needed

- Task 014 must redact evidence before reports can expose it.
- Tasks 015 and 016 must derive Reading and six-domain verdicts from these
  facts rather than reimplementing integrity logic.

## Adjudication

Independent specification, quality, and security reviews approved the final
live worktree. Task 013 is complete.
