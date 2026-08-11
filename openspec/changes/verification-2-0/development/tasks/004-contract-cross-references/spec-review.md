# Spec Review: 004-contract-cross-references

## Verdict

approved

The current production modules, split focused suites, quality-fix receipts,
validation-log attestations, and independent re-runs force support for the Task
004 contract. The structural refactor preserves the previously approved
cross-reference behavior while resolving the quality review's cohesion, test
size, and lossy blocker-deduplication findings.

## Direct Review Scope

- Reviewed the current Task 004 brief, context, report, prior quality review,
  parent requirements, acceptance criteria in Markdown and JSON, and the
  Verification Contract V2 capability spec.
- Reviewed the complete current production implementation:
  `cross-reference-validator.js`, `graph-binding-validator.js`,
  `case-internal-validator.js`, `attempt-binding-validator.js`,
  `case-member-binding-validator.js`, `artifact-binding-validator.js`,
  `reading-evidence-binding-validator.js`, `reference-utils.js`, and
  `retry-identity-validator.js`.
- Reviewed the aggregate `cross-reference.test.js`, all seven split suites, and
  the shared `test-helpers.js`.
- Reviewed the prior quality `needs-fix` decision, system receipts
  `046-004-contract-cross-references.log`,
  `047-004-contract-cross-references.log`, and
  `048-004-contract-cross-references.log`, plus validation-log rows 84-86.
- Compared the current focused test inventory with the pre-refactor system
  receipt. All twelve prior top-level behavior groups remain, and the only new
  top-level test is the blocker payload deduplication regression.
- Kept case approval and approval freshness, evidence file integrity, and
  verdict or gate derivation outside this review.

## Missing Requirements

- No missing Task 004 requirement was found.
- Active change, case snapshot, run, case, attempt, reading, and evidence
  identities remain connected by `graph-binding-validator.js`,
  `attempt-binding-validator.js`, and `artifact-binding-validator.js`.
- Initial attempts still bind `runner` and `browser_project` to the referenced
  case runner. Browser runners require the selected project, while command
  runners require the deterministic value `none`.
- `case-internal-validator.js` still rejects duplicate step and assertion ids,
  unresolved step assertion references, and unresolved assertion references in
  every one of the six case domains.
- `case-member-binding-validator.js` still rejects readings and evidence that
  pair a valid step with an assertion not owned by that step.
- Retry validation still requires retry kind, an existing parent, consecutive
  sequence, and equality across all thirteen immutable fingerprint fields.

## Extra Behavior

- The quality refactor adds semantically lossless blocker deduplication.
  `reference-utils.js:41-64` derives identity from the complete normalized
  blocker payload rather than only its entity path and related entity.
- Exact duplicate blockers are still collapsed, while blockers that differ in
  `expected`, `actual`, or `detail` are retained. Sorting remains deterministic.
- The aggregate focused entry is now only orchestration: it registers each of
  the seven suites exactly once. Test runtime and schema-registry setup are
  isolated in the shared helper.
- These changes strengthen diagnostics and maintainability without expanding
  Task 004 policy ownership.

## Misunderstood Requirements

- No material requirement misunderstanding remains.
- Schema validation is still first. `cross-reference-validator.js:158-165`
  returns graph-shape or exact schema blockers before invoking reference
  validation.
- Source identity consistency is limited to the supplied graph relationships:
  attempts bind to run and case identity, readings and evidence bind to their
  attempts, and retry fingerprints remain immutable.
- Successful reference validation is not treated as case approval, evidence
  file integrity, freshness, domain status, release verdict, or gate authority.

## Cannot Verify From Diff

- The pre-refactor implementation is not a committed comparison baseline in the
  current worktree, so textual equivalence cannot be established from a Git
  diff alone. Behavioral equivalence is instead supported by the unchanged
  twelve-group focused test inventory, current implementation inspection, prior
  and current system-executed receipts, and independent re-runs.
- Explicit case approval and approval freshness remain assigned to Task 005 and
  are not established by this review.
- Evidence path containment, file existence, bytes, hash, size, producer
  allowlisting, and freshness remain assigned to Task 013 and are not
  established by this review.
- Final domain status, release verdict, and gate derivation remain outside Task
  004 and are not established by this review.
- Evidence field shape remains owned by Task 003. This review verifies only that
  the shaped fields agree with their referenced change, run, case, attempt,
  step, assertion, and source identity objects.
- The broader acceptance ledger still records change-level failing states. This
  task review does not claim that the complete change-level criteria are closed.

## Acceptance Assertions Verified

- AC-14
- AC-15
- AC-17
- AC-31

## Independent Re-Run

- `node --test tests/verification-v2/contracts/cross-reference.test.js`
  completed with exit status `0`: 105 tests passed, 0 failed, duration
  `2580.500583 ms`.
- `node --test tests/verification-v2/contracts/*.test.js` completed with exit
  status `0`: 111 tests passed, 0 failed, duration `2963.03375 ms`.
- An independent in-memory blocker collector probe submitted one exact
  duplicate plus variants differing only in `expected`, `actual`, or `detail`.
  The exact duplicate collapsed, all four distinct payloads survived, and two
  consecutive results were identical.
- System receipt `046` records 105 focused tests passing, receipt `047` records
  111 complete contract tests passing, and receipt `048` records syntax checks
  for every refactored production and test module plus `git diff --check`
  passing.
- Validation-log rows 84-86 identify those receipts as `system-executed`, each
  with exit status `0`; the preceding claimed rows were not treated as
  sufficient evidence by themselves.

## Findings

- No specification-conformance blocker remains within Task 004.
- `cross-reference-validator.js` is now limited to graph shape, schema
  normalization, lookup construction, validator orchestration, and the public
  factory. Artifact-family rules are located in cohesive host-neutral modules.
- Existing blocker IDs and field paths remain unchanged:
  cross-reference failures retain
  `verification-contract:cross-reference-invalid`, and retry failures retain
  their kind, parent, sequence, and fingerprint-specific identifiers.
- Reading-to-evidence comparison still covers run, case, attempt, step, and
  assertion identity, while reading and evidence records are independently
  checked against their owning attempt and case members.
- The focused baseline intentionally accepts nonexistent evidence paths,
  mismatched stored bytes metadata, and an unrecognized producer, which confirms
  that Task 013 behavior was not introduced by the refactor.
- Production validation remains read-only; the immutability suite confirms both
  graph and retry inputs are unchanged after validation.
- The broken-reference and stale source-identity portion assigned to Task 004 is
  verified. This is not a claim that the broader evidence-integrity criterion is
  finally closed.

## Required Fixes

No further Task 004 production, test, or contract fix is required by this
independent specification review. Subsequent work must continue to leave case
approval with Task 005, evidence file integrity and freshness with Task 013, and
verdict or gate derivation with their designated downstream owners.
