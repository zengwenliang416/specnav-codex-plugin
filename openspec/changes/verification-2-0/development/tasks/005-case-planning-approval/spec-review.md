# Spec Review: 005-case-planning-approval

## Verdict

approved

The current Task 005 packet binds this slice only to `AC-01` and `AC-02`, and
the latest working tree now provides direct support for both assertions. The
latest fixes also close the previously reported `null` / non-object snapshot
approval bypass and malformed case/source error-path instability.
System-executed receipts `063`-`065` and independent reruns support approval on
the current code, not the earlier blocked snapshots.

## Direct Review Scope

- Read the latest Task 005 `brief.md`, `context.json`, `report.md`, current
  `quality-review.md`, parent requirements, `acceptance.md`,
  `acceptance.json`, and `specs/verification-contract-v2/spec.md`.
- Confirmed the current packet maps Task 005 only to `AC-01` and `AC-02`.
- Reviewed the live implementation in
  `plugins/specnav-verification/kernel/cases/*.js`,
  `plugins/specnav-verification/skills/specnav-verify-plan/SKILL.md`, and
  `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js`.
- Reviewed the focused tests in `tests/verification-v2/cases/*.js`, the CLI
  wrapper `tests/run-verification-v2-case-approval.sh`, the latest Task 005
  validation-log entries, and receipts
  `063-005-case-planning-approval.log`,
  `064-005-case-planning-approval.log`, and
  `065-005-case-planning-approval.log`.
- Independently reran the three Task 005 validation commands in the current
  working tree; all passed.

## Missing Requirements

- No missing requirement remains inside the current Task 005 boundary.
- The current implementation covers the immutable case snapshot, explicit human
  approval, snapshot freshness, source freshness, reviewer identity, and
  non-bypass execution gate required by the updated packet.

## Extra Behavior

- No material out-of-scope behavior was found.
- The current fixes tighten the same slice rather than extending it:
  action/input handling still precedes runtime readiness, snapshot output
  remains create-once, and malformed case/source records now fail with stable
  contract blockers instead of JavaScript exception text.

## Misunderstood Requirements

- No current requirement misunderstanding remains.
- The current packet, tests, and report consistently scope Task 005 to
  `AC-01` / `AC-02`.
- Task `016` still owns terminal six-domain results and Task `017` still owns
  policy-backed `not_applicable` decisions. This review does not claim either
  downstream task is complete, and Task 005 does not falsely claim them done.

## Cannot Verify From Diff

- The main Task 005 production and test files are still untracked in the
  working tree, so a Git patch alone is not sufficient. This review therefore
  relies on live file inspection, current receipts, validation-log rows, and
  independent reruns.
- The report notes that Task `009` must call `assertExecutionApproved` before
  opening a command run. That downstream integration is not proven by Task 005
  evidence.
- This review does not establish terminal six-domain results or final
  `not_applicable` adjudication. Those remain downstream Task `016` / `017`
  responsibilities and are not defects against Task 005 itself.

## Acceptance Assertions Verified

- `AC-01`: met. The case contract requires steps, assertions, six-domain
  mappings, runner choice, and evidence policy before approval in
  `plugins/specnav-verification/schemas/test-case.schema.json`. The planner now
  validates sources, case structure, coverage, duplicates, cross-case change
  consistency, and malformed case/source records through
  `plugins/specnav-verification/kernel/cases/planner.js` and
  `plugins/specnav-verification/kernel/cases/case-validation.js`. The current
  focused suite proves those behaviors in
  `tests/verification-v2/cases/planning.test.js`, including the explicit
  malformed-record regressions. Receipt `063` and my rerun of
  `node --test tests/verification-v2/cases/*.test.js` both passed.
- `AC-02`: met. Execution remains blocked unless a current snapshot exists,
  validates, matches its hash/id, matches current requirements / acceptance,
  and has explicit human approval from the expected reviewer. The latest code
  adds an explicit `verification-cases:snapshot-missing` blocker in
  `plugins/specnav-verification/kernel/cases/approval-validator.js`, keeps
  freshness / principal / binding checks in
  `plugins/specnav-verification/kernel/cases/approval-checks.js`, and exposes
  the gate through
  `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js`.
  The focused suite now covers the prior bypass in
  `tests/verification-v2/cases/approval.test.js` and the CLI `null` snapshot
  path in `tests/verification-v2/cases/cli-integration.js`. Receipts `063` and
  `064`, plus my reruns of the unit and CLI commands, passed.
- `AC-19`, `AC-20`: not part of the current Task 005 acceptance map. They
  remain downstream responsibilities of Tasks `016` and `017` and are not
  claimed complete here.

## Independent Re-Run

- `node --test tests/verification-v2/cases/*.test.js` passed: 30 tests, 0
  failed.
- `bash tests/run-verification-v2-case-approval.sh` passed.
- `for file in plugins/specnav-verification/kernel/cases/*.js plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js tests/verification-v2/cases/*.js; do node --check "$file" || exit 1; done && git diff --check -- plugins/specnav-verification/kernel/cases plugins/specnav-verification/skills/specnav-verify-plan tests/verification-v2/cases tests/run-verification-v2-case-approval.sh openspec/changes/verification-2-0/development/tasks/005-case-planning-approval openspec/changes/verification-2-0/development/task-context.jsonl`
  passed.

## Findings

- The immutable snapshot and explicit human approval gate are credibly
  implemented and verified for the current Task 005 slice.
- The prior quality blockers documented in
  `development/evidence/058-005-case-planning-approval-quality-review-needs-fix.md`
  are resolved in the current working tree:
  `approval-validator.js` now blocks missing / `null` / non-object snapshots,
  and `case-validation.js` now sends malformed case and source records through
  schema validation before normalization.
- The current focused suite and CLI integration now cover the previously
  missing negative paths: missing / `null` / malformed snapshot, duplicate and
  invalid source ids, malformed source records, duplicate case ids, change
  mismatch, malformed case records, unsupported action, malformed JSON,
  runtime-not-ready precedence, missing output, and non-overwriting blocked
  snapshot writes.
- Task `016` and Task `017` ownership remains explicit and is not being
  backfilled by this approval.

## Required Fixes

No blocking Task 005 fix is required by this independent specification review.
Subsequent work should continue to keep Task `009` responsible for consuming
`assertExecutionApproved`, Task `016` responsible for terminal six-domain
results, and Task `017` responsible for policy-backed `not_applicable`
decisions.
