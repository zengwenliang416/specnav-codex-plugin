# Task Report: 005-case-planning-approval

## Status

DONE

## Files Changed

- `plugins/specnav-verification/kernel/cases/**`
- `plugins/specnav-verification/skills/specnav-verify-plan/SKILL.md`
- `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js`
- `tests/verification-v2/cases/**`
- `tests/run-verification-v2-case-approval.sh`
- Task 005 packet, ledger, validation receipts, and append-only RED evidence

## What Changed

- Added deterministic canonical JSON and SHA-256 utilities with key ordering,
  newline and Unicode normalization, non-JSON rejection, and cycle rejection.
- Added case normalization and a planner that requires schema-valid ready cases,
  complete requirement and acceptance coverage, all six domain mappings,
  resolvable step/domain assertions, and coherent evidence policies.
- Added an immutable snapshot writer. Snapshot identity binds normalized cases,
  requirement and acceptance hashes, creator identity, and creation time.
- Added an approval validator that blocks execution unless an exact current
  snapshot has explicit human approval from the expected reviewer.
- Approval now becomes stale when case content, source contracts, snapshot
  identity, provenance, approval identity, decision, or approval time changes.
- Added a thin managed-runtime CLI for snapshot creation and approval checks.
- CLI action and input validation now precede managed-runtime initialization,
  so unsupported actions, missing arguments, and malformed JSON return their
  exact blockers even when the runtime is unavailable.
- Snapshot output is create-once. Existing files are never replaced, temporary
  files are removed on failure, and blocked plans preserve existing bytes.
- Extracted source/case/coverage rules into `case-validation.js` and
  snapshot/approval freshness and binding rules into `approval-checks.js`.
- Removed the verification light-lane instructions from the planning skill.

## TDD Evidence

- `development/evidence/049-005-case-planning-approval-red.log` preserves the
  initial missing-module and missing-CLI failures.
- `development/evidence/050-005-case-planning-approval-quality-red.log`
  preserves the second RED pass for source freshness, provenance integrity,
  approval identity/time, internal case references, and evidence-policy gaps.
- `development/evidence/051-005-case-planning-approval.log` records the final
  system-executed `21/21` focused assertions.
- `development/evidence/052-005-case-planning-approval.log` records the
  system-executed CLI integration pass.
- `development/evidence/053-005-case-planning-approval.log` records syntax and
  scoped diff validation.
- `development/evidence/054-005-case-planning-approval-review-red.log`
  preserves the review-driven RED run before immutable output behavior was
  implemented.
- `development/evidence/055-005-case-planning-approval-quality-review-needs-fix.md`
  and `056-005-case-planning-approval-spec-review-blocked.md` preserve both
  failed independent reviews.
- `development/evidence/055-005-case-planning-approval.log`,
  `056-005-case-planning-approval.log`, and
  `057-005-case-planning-approval.log` are the second system-executed focused,
  CLI, syntax, and scoped-diff receipts.
- `development/evidence/058-005-case-planning-approval-quality-review-needs-fix.md`
  and `059-005-case-planning-approval-gate-red.log` preserve the discovered
  missing-snapshot gate bypass and malformed-record failure before repair.
- `development/evidence/063-005-case-planning-approval.log`,
  `064-005-case-planning-approval.log`, and
  `065-005-case-planning-approval.log` are the final system-executed receipts:
  30 focused assertions, CLI integration, syntax checks, and scoped diff
  validation all passed.

## Verification Commands

- `node --test tests/verification-v2/cases/*.test.js`
- `bash tests/run-verification-v2-case-approval.sh`
- `for file in plugins/specnav-verification/kernel/cases/*.js plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js tests/verification-v2/cases/*.js; do node --check "$file" || exit 1; done`
- `git diff --check -- plugins/specnav-verification/kernel/cases plugins/specnav-verification/skills/specnav-verify-plan tests/verification-v2/cases tests/run-verification-v2-case-approval.sh`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-development-plugin-fixtures.sh`
- `bash tests/run-verification-plugin-fixtures.sh`

## Concerns

- Task 005 establishes the immutable approved case contract and complete
  six-domain planning surface. Terminal readings and policy-backed
  `not_applicable` decisions remain owned by Tasks 016 and 017.

## Scope Deviations

- The task packet originally omitted
  `tests/run-verification-v2-case-approval.sh` from `Files Allowed` while
  requiring that exact script under `Verification Commands`. The packet and
  CodeGraph claim were corrected to include the pre-existing required test
  surface; no production scope was expanded.
- The task packet also incorrectly bound Task 005 to `AC-19` and `AC-20`.
  Those assertions require terminal six-domain aggregation and policy-backed
  `not_applicable` decisions owned by Tasks 016 and 017. The Task 005 brief,
  context, and generated task-context entry now bind only `AC-01` and `AC-02`;
  no acceptance requirement was removed from the change.

## Follow-up Needed

- Task 009 must require `assertExecutionApproved` before opening a command run.
- Tasks 016 and 017 must derive terminal six-domain results and validate
  policy-backed `not_applicable` decisions from the approved snapshot.

## Adjudication

Independent specification and quality reviews both approved the final worktree.
AC-01 and AC-02 are directly supported by current code, focused tests, CLI
integration, and system-executed receipts. No fallback, simplified verification
mode, legacy signoff promotion, or business-project dependency mutation was
introduced.
