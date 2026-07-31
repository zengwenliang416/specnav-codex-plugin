# Task Report: 002-kernel-package-boundary

## Status

DONE

## Files Changed

- `plugins/specnav-verification/package.json`
- `plugins/specnav-verification/kernel/index.js`
- `plugins/specnav-verification/kernel/metadata.js`
- `plugins/specnav-verification/kernel/contracts.js`
- `tests/verification-v2/kernel/package-boundary.test.js`
- `docs/verification-kernel-packaging.md`
- Task 002 lifecycle evidence and review artifacts.

## What Changed

- Added the canonical `@specnav/verification-kernel` package at version
  `2.0.0-alpha.1`.
- Added one public root export with immutable version metadata and a SHA-256
  contract digest.
- Defined explicit contracts for command, browser, AI interaction, evidence,
  failure classification, and report rendering services.
- Added fail-fast service validation with exact missing-service and
  missing-method errors. No fallback or inferred service exists.
- Documented package ownership, host import rules, drift evidence, and the
  capabilities intentionally deferred to later tasks.

## TDD Evidence

- RED: `node --test tests/verification-v2/kernel/*.test.js` initially failed
  four tests because the package manifest and kernel directory did not exist.
- GREEN: the same command passes four tests covering package exports, immutable
  metadata, explicit service contracts, fail-fast behavior, and forbidden host
  runtime dependencies.

## Verification Commands

- `node --test tests/verification-v2/kernel/*.test.js`
- `node --check plugins/specnav-verification/kernel/index.js`

## Concerns

- This task establishes the shared ownership boundary only. Schema validation,
  execution, evidence, evaluation, report behavior, and host installation are
  intentionally absent until their dependent tasks.

## Scope Deviations

- No scope deviations were made.

## Follow-up Needed

- Tasks 003 through 027 must add host-neutral behavior behind this public
  boundary.
- Tasks 028 through 031 must prove all host adapters consume this package
  without carrying duplicate verdict logic.
