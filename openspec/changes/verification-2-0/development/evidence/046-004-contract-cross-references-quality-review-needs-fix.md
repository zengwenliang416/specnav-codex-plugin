# Task 004 Quality Review: Needs Fix

Recorded at: `2026-07-31T09:24:20Z`

The independent quality reviewer reran:

- `node --test tests/verification-v2/contracts/cross-reference.test.js`
  - 104 passed, 0 failed
- `node --test tests/verification-v2/contracts/*.test.js`
  - 110 passed, 0 failed

The reviewer returned `needs-fix` for maintainability rather than observed
behavior:

1. `cross-reference-validator.js` still combines graph shape, schema
   normalization, case internals, attempts, readings, evidence, retries, and
   factory orchestration in one 658-line module.
2. The blocker collector's dedupe key can silently collapse blockers with the
   same entity path but different `expected`, `actual`, or `detail` payloads.
3. `cross-reference.test.js` combines runtime bootstrap, fixtures, helpers, and
   every scenario in one 910-line file.

The complete review remains in
`development/tasks/004-contract-cross-references/quality-review.md`.
