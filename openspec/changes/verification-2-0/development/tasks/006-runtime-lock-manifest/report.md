# Task Report: 006-runtime-lock-manifest

## Status

DONE

## Files Changed

- `plugins/specnav-verification/assets/runtime/verification-runtime-lock.json`
- `plugins/specnav-verification/kernel/runtime/lock-manifest.js`
- `tests/verification-v2/runtime/lock-manifest.test.js`
- Task 006 lifecycle evidence and review artifacts.

## What Changed

- Added runtime lock `2.0.0-alpha.1` with exact versions and registry
  integrity for Playwright, Playwright Test, Midscene Web, AJV, and AJV
  formats.
- Pinned Chromium and Chromium headless-shell revision `1234`, exact
  `darwin-arm64` URLs, SHA-256 hashes, and byte sizes.
- Added explicit Node 20-24, `darwin-arm64`, browser, and complete Kernel
  identity compatibility policies.
- Added a resolver that accepts only the exact runtime version and returns
  exact blockers for unsupported version, Node, platform, missing Kernel
  identity, or any Kernel identity mismatch.
- Explicitly forbade system browser, channel, and global-cache fallback.

## TDD Evidence

- RED: the focused test failed because the lock resolver module did not exist.
- RED repair receipt `015` proves the earlier fallback and incomplete identity
  behavior failed the strengthened tests.
- GREEN receipts `016` and system-executed `017` prove five tests covering
  required packages, full Kernel identity, browser artifact integrity, exact
  version resolution, and compatibility blockers.

## Verification Commands

- `node --test tests/verification-v2/runtime/lock-manifest.test.js`

## Concerns

- Registry integrity, browser revisions, URLs, hashes, and sizes are frozen as
  of July 31, 2026.
  Future runtime versions require a new side-by-side manifest; this manifest
  must not be edited in place after release.

## Scope Deviations

- The execution graph was corrected so lock/install/doctor precede executable
  schema validation. This removes the previous AJV dependency cycle and
  enforces the no-fallback policy.

## Follow-up Needed

- Task 007 must install this exact lock outside the business repository and
  retain an installation receipt.
- Task 008 must probe package and browser readiness before Task 003 uses AJV.
