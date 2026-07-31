# Task Report: 012-evidence-store

## Status

DONE

## Delivered Slice

Reviewer can retain append-only evidence records and content-addressed objects,
rebuild a deterministic summary index, and resolve evidence through a
validated index without losing earlier failed attempts.

## Files Changed

- `plugins/specnav-verification/kernel/evidence/**`
- `plugins/specnav-verification/kernel/index.js`
- `tests/verification-v2/evidence/evidence-store.test.js`
- `tests/verification-v2/kernel/package-boundary.test.js`
- Task packet, validation log, ledger, drift record, and append-only evidence

## What Changed

- Added immutable evidence identity from canonical JSON metadata plus content
  hash and size.
- Added the frozen storage layout: `raw.jsonl`,
  `objects/<content-hash>.<ext>`, `index.json`, and
  `cache/index-meta.json`.
- Added append locking, `O_NOFOLLOW`, complete short-write handling,
  content-addressed exclusive publication, and path/symlink containment.
- Added deterministic index rebuilds with source-digest race detection and
  derived-publication rollback.
- Added index-backed `getById()` and `resolve()` APIs that block missing,
  invalid, or stale indexes instead of scanning raw data as fallback.
- Added JSON-candidate validation before clone, hash, or Schema validation.
- Preserved the frozen Kernel service contract at `append/rebuildIndex`; the
  concrete store read APIs do not change the runtime contract digest.

## TDD Evidence

- `141-012-evidence-store-red.md` records the original missing EvidenceStore.
- `142-012-evidence-store-quality-review-not-approved.md`,
  `143-012-evidence-store-spec-review-not-approved.md`, and
  `144-012-evidence-store-quality-rereview-not-approved.md` preserve failed
  independent reviews and their required fixes.
- `145-012-evidence-store.log` records the final focused suite at 33/33.
- `146-012-evidence-store.log` records the final full suite at 242/242.
- `147` through `149` `.log` files record both plugin fixtures and final static
  checks after public API hardening.
- `143-012-evidence-store.log` records the managed runtime doctor as ready.

## Verification Commands

- `node --test tests/verification-v2/evidence/evidence-store.test.js tests/verification-v2/kernel/package-boundary.test.js tests/verification-v2/contracts/schema-registry.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `node plugins/specnav-verification/scripts/verification-runtime.js doctor --version 2.0.0-alpha.1 --project /Volumes/zwl/AI/ai-coding/specnav-codex-plugin --root /Users/wenliang_zeng/.specnav/runtime/verification --json`
- `for file in plugins/specnav-verification/kernel/evidence/*.js tests/verification-v2/evidence/*.js tests/verification-v2/kernel/package-boundary.test.js; do node --check "$file" || exit 1; done && git diff --check`

## Concerns

- Evidence integrity verdicts remain Task 013.
- Secret redaction remains Task 014.
- Reading and domain verdict derivation remain Tasks 015 and 016.

## Scope Deviations

- The task packet was corrected to distinguish the frozen service contract
  from concrete in-process read APIs. No runtime contract version changed.

## Follow-up Needed

- Task 013 must verify object bytes, record binding, freshness, and tampering
  before any evidence can support a green verdict.

## Adjudication

Independent specification and quality reviews approved the final live
worktree. Task 012 is complete.
