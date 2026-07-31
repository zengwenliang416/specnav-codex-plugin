# Spec Review: 005-case-planning-approval

## Verdict

blocked

The current Task 005 diff, focused tests, system receipts `051`-`053`, and
independent reruns support the immutable pre-execution case snapshot and
explicit approval gate, but they do not force support for `AC-19` or `AC-20`.
Task 005 establishes a six-domain planning surface and a current-snapshot
approval contract; it does not prove terminal six-domain results or final
policy-backed `not_applicable` decisions, and the task report itself says those
remain with Tasks `016` and `017`.

## Direct Review Scope

- Read the current Task 005 brief, context, report, parent requirements,
  `acceptance.md`, `acceptance.json`, and
  `specs/verification-contract-v2/spec.md`.
- Reviewed the live working-tree implementation in
  `plugins/specnav-verification/kernel/cases/*.js`,
  `plugins/specnav-verification/skills/specnav-verify-plan/SKILL.md`,
  `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js`,
  `plugins/specnav-verification/schemas/*.json`, and the positive case fixture
  used by the Task 005 tests.
- Reviewed the focused Task 005 tests in
  `tests/verification-v2/cases/*.js`, the CLI wrapper
  `tests/run-verification-v2-case-approval.sh`, validation-log rows `90`-`92`,
  and evidence logs `051-005-case-planning-approval.log`,
  `052-005-case-planning-approval.log`, and
  `053-005-case-planning-approval.log`.
- Independently reran the three Task 005 validation commands in the current
  worktree; all passed with exit status `0`.

## Missing Requirements

- `AC-19` is not directly verified by the Task 005 evidence. The reviewed
  implementation requires every test case to carry all six domain assignments:
  `plugins/specnav-verification/schemas/test-case.schema.json:158-188`,
  `plugins/specnav-verification/kernel/cases/normalize.js:5-12`,
  `plugins/specnav-verification/kernel/cases/planner.js:88-115`, and
  `plugins/specnav-verification/skills/specnav-verify-plan/SKILL.md:24-25`
  plus `:47-52`. That is planning coverage, not terminal domain results.
  Nothing in the Task 005 diff or receipts produces or validates per-domain
  terminal readings for approved cases, and the task report explicitly says
  terminal readings remain with Task `016`:
  `openspec/changes/verification-2-0/development/tasks/005-case-planning-approval/report.md:55-57`
  and `:69-71`.
- `AC-20` is not directly verified by the Task 005 evidence. Shared schema
  support exists for `not_applicable`: the decision payload requires `reason`,
  `evidence_ids`, `reviewer`, `approved_at`, and `policy_ref` in
  `plugins/specnav-verification/schemas/common.schema.json:302-333`, and a
  domain using `mode: "not_applicable"` must carry that object at
  `plugins/specnav-verification/schemas/common.schema.json:335-389`. However,
  the Task 005 focused tests never create a `not_applicable` case or assert
  rejection for missing fields; they exercise only ordinary required-domain
  cases and approval freshness:
  `tests/verification-v2/cases/planning.test.js:13-185`,
  `tests/verification-v2/cases/approval.test.js:50-200`, and
  `tests/verification-v2/cases/test-helpers.js:33-49`.

## Extra Behavior

- The skill diff removes the prior light-lane planning instructions and forces
  every verification plan onto the full six-domain path:
  `plugins/specnav-verification/skills/specnav-verify-plan/SKILL.md:24-25`
  and `:48-52`. That is aligned with the change-level requirement that
  Verification 2.0 has no simplified lane, but it is broader than the narrow
  Task 005 slice of case snapshot approval.

## Misunderstood Requirements

- The implementation and report correctly frame Task 005 as pre-execution case
  approval plus six-domain planning, but the task acceptance binding still
  expects direct evidence for `AC-19` and `AC-20`. The Task 005 focused harness
  only injects `AC-01` and `AC-02` into the source acceptance set and sample
  case:
  `tests/verification-v2/cases/test-helpers.js:27-49`. As a result, the green
  `051` receipt cannot be read as direct proof of `AC-19` or `AC-20`.
- Task 005 must not be interpreted as completing Tasks `016` or `017`. The
  report correctly says terminal six-domain readings and policy-backed
  `not_applicable` decisions remain downstream:
  `openspec/changes/verification-2-0/development/tasks/005-case-planning-approval/report.md:55-57`
  and `:69-71`. The review outcome has to match that boundary.

## Cannot Verify From Diff

- The main Task 005 production and test files are currently untracked in the
  worktree, so `git diff` alone does not show their full textual changes. This
  review therefore used live file inspection, validation-log attestations, raw
  evidence logs, and independent reruns instead of relying on a patch-only
  comparison.
- The Task 005 diff and receipts do not show any reading, aggregate, or gate
  artifact that would establish terminal results for all six domains. That
  remains Task `016` responsibility and cannot be inferred from the planning
  surface alone.
- The Task 005 diff and receipts do not show a policy-backed
  `not_applicable` decision flowing through execution or downstream review.
  That remains Task `017` responsibility and cannot be inferred from shared
  schema presence alone.
- The report notes that Task `009` must call `assertExecutionApproved` before
  opening a command run:
  `openspec/changes/verification-2-0/development/tasks/005-case-planning-approval/report.md:69`.
  That downstream consumption is not verified by Task 005 evidence.

## Acceptance Assertions Verified

- `AC-01`: met. The case contract requires steps, assertions, six domain
  mappings, runner choice, and evidence policy before snapshot approval in
  `plugins/specnav-verification/schemas/test-case.schema.json:7-25` and
  `:158-249`. The planner validates source coverage and coherent case structure
  in `plugins/specnav-verification/kernel/cases/planner.js:146-250`, and the
  immutable snapshot writer freezes the reviewed case set in
  `plugins/specnav-verification/kernel/cases/snapshot-writer.js:31-80`. The
  system-executed focused pass in
  `openspec/changes/verification-2-0/development/evidence/051-005-case-planning-approval.log:1`
  and the independent rerun of `node --test tests/verification-v2/cases/*.test.js`
  both passed.
- `AC-02`: met. Execution stays blocked unless the exact current snapshot has
  explicit human approval from the expected reviewer and current requirements /
  acceptance hashes in
  `plugins/specnav-verification/kernel/cases/approval-validator.js:25-199`.
  The managed CLI exposes the snapshot and approval check paths at
  `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js:67-126`.
  System-executed evidence exists in
  `openspec/changes/verification-2-0/development/evidence/051-005-case-planning-approval.log:1`,
  `openspec/changes/verification-2-0/development/evidence/052-005-case-planning-approval.log:1`,
  and validation-log rows `90`-`92`; the same unit and CLI commands passed
  again during this review.
- `AC-19`: not verified from the Task 005 diff or Task 005 receipts. The
  current evidence proves six-domain planning completeness, not terminal
  six-domain results for approved cases.
- `AC-20`: not verified from the Task 005 diff or Task 005 receipts. Shared
  schema support exists for `not_applicable`, but Task 005 does not provide a
  focused test or system-executed receipt proving enforcement of the required
  reason, evidence, reviewer identity, approval timestamp, and policy
  allowance.

## Independent Re-Run

- `node --test tests/verification-v2/cases/*.test.js` passed: 21 tests, 0
  failed.
- `bash tests/run-verification-v2-case-approval.sh` passed.
- `for file in plugins/specnav-verification/kernel/cases/*.js plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js tests/verification-v2/cases/*.js; do node --check "$file" || exit 1; done && git diff --check -- plugins/specnav-verification/kernel/cases plugins/specnav-verification/skills/specnav-verify-plan tests/verification-v2/cases tests/run-verification-v2-case-approval.sh`
  passed.

## Findings

- The immutable snapshot and explicit human approval gate are credibly
  implemented and verified for Task 005’s actual slice.
- Approval is still blocked because the current Task 005 evidence does not
  independently close `AC-19` or `AC-20`.
- Task `016` and Task `017` downstream ownership is explicit and must not be
  backfilled by a Task 005 approval.

## Required Fixes

- Either narrow the Task 005 acceptance binding and expected direct evidence to
  the pre-execution slice actually implemented, or add focused production/test
  evidence that truly verifies `AC-19` and `AC-20` within Task 005.
- If `AC-20` stays bound to Task 005, add a focused case fixture with at least
  one `mode: "not_applicable"` domain and Task 005 tests / receipts proving
  that missing `reason`, `evidence_ids`, `reviewer`, `approved_at`, or
  `policy_ref` is rejected while a valid payload survives snapshot creation and
  approval validation.
- Do not claim Task `016` or Task `017` complete from Task 005. Terminal
  six-domain results remain Task `016` responsibility, and policy-backed
  `not_applicable` decision validation remains Task `017` responsibility, as
  already stated in
  `openspec/changes/verification-2-0/development/tasks/005-case-planning-approval/report.md:55-57`
  and `:69-71`.
