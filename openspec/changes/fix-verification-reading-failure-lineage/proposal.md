## Why

The repair-loop state machine currently rejects a valid failure when the
runner attempt passes but a later six-domain reading fails or is blocked. This
prevents a reviewed repair from reaching retest and regression evaluation even
though the trusted failure classifier already preserved the reading-level
failure.

## What Changes

- Accept an initial `passed` attempt as a valid repair-loop root only when the
  trusted classification envelope binds a reading-level failure packet to that
  exact attempt.
- Preserve the attempt fact as `pass`; do not rewrite historical attempt,
  failure, reading, or evidence artifacts.
- Add focused positive and fail-closed tests for reading-level failure lineage.
- Keep Playwright execution, runtime networking, evidence, and product
  repositories unchanged.

## Capabilities

### New Capabilities

- `verification-reading-failure-lineage`: Repair-loop evaluation can represent
  a trusted failed or blocked reading whose runner attempt completed
  successfully.

### Modified Capabilities

- None.

## Impact

- Runtime source:
  `plugins/specnav-verification/kernel/repair/repair-loop-state-machine.js`
- Tests:
  `tests/verification-v2/repair-loop/state-machine.test.js`
- No schema, public API, dependency, product-code, historical-artifact, or
  Playwright network-policy changes.
