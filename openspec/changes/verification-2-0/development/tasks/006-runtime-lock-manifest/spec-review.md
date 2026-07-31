# Spec Review: 006-runtime-lock-manifest

## Verdict

approved

## Missing Requirements

- No requirement is missing from the Task 006 lock-manifest boundary; runtime
  installation and readiness probing remain explicitly assigned to Tasks 007
  and 008.

## Extra Behavior

- None. The task remains limited to the committed runtime lock, compatibility
  resolver, and focused tests.

## Misunderstood Requirements

- No requirement is currently misunderstood: Task 006 freezes exact runtime
  identity and compatibility inputs without claiming installation or doctor
  behavior.

## Cannot Verify From Diff

- Browser archive integrity was verified independently by downloading both
  locked `darwin-arm64` artifacts and matching their SHA-256 and byte size.

## Acceptance Assertions Verified

- `AC-04`: the lock fixes runtime, package, browser revision, URL, SHA-256, and
  size inputs needed by the explicit installer.
- `AC-05`: the resolver returns exact blockers for unsupported runtime, Node,
  platform, missing Kernel identity, and every Kernel identity mismatch.

## Required Fixes

- No further specification fix is required for Task 006 because `AC-04` and
  `AC-05` are supported by the exact lock identity and mismatch blockers.

## Direct Evidence

- `development/evidence/017-006-runtime-lock-manifest.log` is a
  system-executed 5/5 passing receipt.
- `kernel/runtime/lock-manifest.js` contains no Kernel metadata fallback and
  validates name, version, API version, contract version, and contract digest.
- `assets/runtime/verification-runtime-lock.json` supports only the explicitly
  locked `darwin-arm64` platform and contains integrity material for Chromium
  and Chromium headless shell.
