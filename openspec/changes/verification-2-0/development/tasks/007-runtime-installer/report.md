# Task Report: 007-runtime-installer

## Status

DONE

## Files Changed

- `plugins/specnav-verification/kernel/runtime/installer.js`
- `plugins/specnav-verification/kernel/runtime/lock-manifest.js`
- `plugins/specnav-verification/scripts/verification-runtime.js`
- `plugins/specnav-verification/skills/specnav-verification-runtime-setup/SKILL.md`
- `tests/verification-v2/runtime/installer.test.js`
- `tests/run-verification-runtime-install.sh`
- `tests/run-verification-runtime-cli-install.sh`
- Task lifecycle evidence and review artifacts.

## What Changed

- Added an explicit side-by-side installer under
  `~/.specnav/runtime/verification/<version>/`.
- Installed exact locked Playwright, Midscene, and AJV packages without
  modifying the business repository.
- Downloaded only locked browser URLs and verified byte size and SHA-256 before
  extraction.
- Added staging-to-target atomic promotion, append-only failed-attempt
  directories, and complete success/failure receipts.
- Added structured progress events and exact attempt logs for npm, curl, and
  ditto, including command argv, stdout, stderr, exit status, and affected
  artifact.
- Canonicalized runtime paths with `realpath` before invoking npm to prevent
  symlinked `/tmp` paths from producing file-link package-lock entries.

## TDD Evidence

- RED `018`: installer module did not exist.
- Failed system receipt `021`: clean-root CLI exposed the `/tmp` versus
  `/private/tmp` package-lock identity defect.
- GREEN system receipts `024`, `025`, and `026`: real CLI install and seven
  focused installer tests pass after the repair.

## Verification Commands

- `bash tests/run-verification-runtime-cli-install.sh`
- `bash tests/run-verification-runtime-install.sh`
- `node --test tests/verification-v2/runtime/installer.test.js`

## Concerns

- Runtime `2.0.0-alpha.1` currently supports only `darwin-arm64`, matching the
  committed browser integrity lock.

## Scope Deviations

- The clean-root CLI acceptance script was added after independent quality
  review correctly identified that unit fixtures did not prove the shipped CLI
  entrypoint.

## Follow-up Needed

- Task 008 must independently probe the installed package tree, package lock,
  browser executables, launch readiness, provider configuration, permissions,
  receipt, and Kernel identity.

## Adjudication

- Failed receipts remain evidence and are not overwritten by later green runs.
