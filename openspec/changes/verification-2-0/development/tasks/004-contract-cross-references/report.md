# Task Report: 004-contract-cross-references

## Status

DONE

## Files Changed

- `plugins/specnav-verification/kernel/contracts/cross-reference-validator.js`
- `plugins/specnav-verification/kernel/contracts/reference-utils.js`
- `plugins/specnav-verification/kernel/contracts/retry-identity-validator.js`
- `tests/verification-v2/contracts/cross-reference.test.js`

## What Changed

- Added a schema-first, host-neutral cross-reference validator for one active
  change, case snapshot, run, attempts, readings, and evidence records.
- Added exact deterministic blockers for active-change, snapshot, run, case,
  attempt, step, assertion, evidence, and source identity disagreements.
- Added reading-to-evidence binding so a reading cannot cite evidence from a
  different run, case, attempt, step, or assertion even when both entities are
  independently shape-valid.
- Bound every initial attempt's `browser_project` to the referenced case
  runner: browser runners use the case-selected project and command runners
  require the deterministic value `none`.
- Added case-internal graph validation for unique step and assertion ids, every
  step `assertion_ids` reference, and each of the six domain `assertion_ids`
  collections.
- Added step-specific assertion binding so readings and evidence cannot pair a
  valid step with an assertion owned by a different step.
- Added retry classification that requires an existing parent, consecutive
  sequence, explicit retry kind, and an unchanged 13-field execution
  fingerprint.
- Extracted duplicate-id lookup, blocker formatting, stable sorting, and retry
  fingerprint comparison into cohesive helpers.
- Split case-internal, attempt, graph, case-member, reading/evidence, and
  artifact binding policy into separate host-neutral modules. The public
  `cross-reference-validator.js` now contains only graph-shape validation,
  schema-first normalization, lookup orchestration, and the factory.
- Made blocker deduplication use the complete normalized blocker payload so
  diagnostics with the same entity path but different expected, actual, or
  detail values are preserved.
- Split the focused test implementation into seven suites plus one shared
  managed-runtime/schema-registry helper. The original
  `cross-reference.test.js` remains a 15-line aggregate entry and executes each
  suite exactly once.
- All validation is read-only and requires the Task 003 schema registry. No
  fallback validator or host-specific dependency is available.

## TDD Evidence

- RED evidence `039` records 77 tests with one schema-valid baseline pass and
  76 failures caused only by the missing cross-reference module.
- Specification-repair RED evidence
  `044-004-contract-cross-references-spec-fix-red.md` preserves 91 passes and
  13 failures: twelve focused contract defects plus the parent aggregation
  failure.
- The final focused suite contains 105 tests covering positive identity chains,
  exact missing/mismatched references, retry semantics, every immutable retry
  fingerprint field, schema-first ordering, reading-to-evidence binding,
  case-internal references, browser project selection, duplicate IDs,
  malformed graph arrays, input immutability, and semantically lossless blocker
  deduplication.
- The complete contracts suite contains 111 passing tests, preserving all Task
  003 schema and package behavior.
- System-executed receipts
  `043-004-contract-cross-references.log`,
  `044-004-contract-cross-references.log`, and
  `045-004-contract-cross-references.log` replayed the repaired focused suite,
  complete contract suite, syntax checks, and diff check with exit status `0`.
- Quality-fix system receipts
  `046-004-contract-cross-references.log`,
  `047-004-contract-cross-references.log`, and
  `048-004-contract-cross-references.log` replayed the modularized focused
  suite, complete contract suite, all production and test syntax checks, and
  the diff check with exit status `0`.

## Verification Commands

- `node --test tests/verification-v2/contracts/cross-reference.test.js`
- `node --test tests/verification-v2/contracts/*.test.js`
- `node --check plugins/specnav-verification/kernel/contracts/cross-reference-validator.js && node --check plugins/specnav-verification/kernel/contracts/reference-utils.js && node --check plugins/specnav-verification/kernel/contracts/retry-identity-validator.js && git diff --check`

## Concerns

- The largest focused suite is 304 lines and the shared helper is 265 lines.
  The aggregate entry is 15 lines, and the largest production module is 176
  lines.
- Full evidence file containment, existence, hash, size, producer allowlisting,
  and freshness are intentionally not checked here.

## Scope Deviations

- None recorded.

## Follow-up Needed

- Task 005 must add immutable case snapshot approval and stale-approval
  handling.
- Task 013 must add evidence path, bytes, hash, size, producer, and freshness
  integrity checks.

## Adjudication

- AC-14 and AC-15 are directly implemented by immutable case-to-attempt
  execution identity, browser-project binding, and retry validators.
- Task 004 implements the broken-reference and stale source-identity portion of
  AC-17, including case-internal and step-specific assertion references. File
  integrity and producer portions remain assigned to Task 013.
- AC-31 shape ownership remains in Task 003; this task proves those fields bind
  to the referenced case, step, attempt, and execution chain.
