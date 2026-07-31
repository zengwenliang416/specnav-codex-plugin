# Task 004 Spec Review: Needs Fix

Recorded at: `2026-07-31T08:48:18Z`

The independent specification reviewer reran:

- `node --test tests/verification-v2/contracts/cross-reference.test.js`
  - exit `0`
  - 89 passed, 0 failed
- `node --test tests/verification-v2/contracts/*.test.js`
  - exit `0`
  - 95 passed, 0 failed

The green suites did not cover three shape-valid contract defects:

1. `attempt.browser_project` was not bound to the referenced case runner.
2. Case-internal step, assertion, and domain assertion references were not
   checked for existence and uniqueness.
3. A reading or evidence record carrying both `step_id` and `assertion_id`
   could pair an assertion with the wrong step.

The reviewer returned `needs-fix`. The full review remained in
`development/tasks/004-contract-cross-references/spec-review.md` until the
required repair and re-review.
