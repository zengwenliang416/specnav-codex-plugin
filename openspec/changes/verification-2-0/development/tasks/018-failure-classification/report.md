# Task Report: 018-failure-classification

## Status

DONE

## Files Changed

- `plugins/specnav-verification/kernel/repair/failure-classifier.js`
- Kernel repair and public exports
- `plugins/specnav-verification/schemas/failure-packet.schema.json`
- Focused repair-loop, schema-registry, and package-boundary tests
- Task packet, task graph, context, ledger, validation log, and append-only
  evidence

## What Changed

- Added a host-neutral failure classifier with six deterministic categories:
  product defect, test defect, environment defect, flaky, expected blocker,
  and requirement ambiguity.
- Required a schema-valid failed or blocked Reading and exact bindings to its
  failed assertions, evidence ids, and integrity facts.
- Snapshotted the trusted root-cause catalog at classifier construction.
- Froze every packet and bound packet identity to all packet fields, Reading,
  Evidence, root-cause content, and strict RFC3339 timestamps.
- Added a constrained unclassified state that preserves a schema-valid frozen
  open packet while returning `classification-missing`.
- Emitted `break_loop_required` only as a signal. Task 020 and SpecNav Core
  retain lifecycle transition and break-loop decision authority.

## TDD Evidence

- `265-018-failure-classification.log` preserves the missing classifier and
  public export RED state.
- `266-018-failure-classification.log` preserves the trusted root-cause
  contract RED state.
- `267-018-failure-classification.log` proves the initial focused GREEN at
  `33/33`.
- `268-018-failure-classification-spec-review-not-approved.md` and
  `269-018-failure-classification-quality-review-not-approved.md` preserve the
  independent blocked reviews.
- `268-018-failure-classification.log` preserves five reproduced review
  failures; `269-018-failure-classification.log` proves the repaired focused
  contract at `148/148`.
- `270-018-failure-classification-spec-review-approved.md` and
  `271-018-failure-classification-quality-review-approved.md` record final
  independent approvals.
- System receipts `270` and `271` prove the full `399/399` Verification 2.0
  regression and both plugin contracts.
- Receipts `272`, `274`, and `275` preserve lifecycle and diagnostic failures;
  receipt `276` proves exact checklist-goal alignment and append-only
  adjudications retire those failures.
- Receipt `277` proves lifecycle maintenance passes before completion with 48
  legitimate downstream blockers remaining.
- Receipts `278` and `279` prove the completed Task 018 lifecycle blocker is
  retired and the final maintenance/diff closure passes with 47 legitimate
  downstream blockers remaining.

## Verification Commands

- `node --test tests/verification-v2/repair-loop/classifier.test.js`
- `node --test tests/verification-v2/repair-loop/classifier.test.js tests/verification-v2/contracts/schema-registry.test.js tests/verification-v2/contracts/cross-reference.test.js tests/verification-v2/kernel/package-boundary.test.js tests/verification-v2/evaluation/reading-model.test.js tests/verification-v2/evaluation/aggregation.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `bash tests/run-verification-v2-development-contract-maintenance.sh`
- `git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log' ':(exclude)openspec/changes/verification-2-0/codegraph/*.json'`

## Concerns

- Task 019 must create and route the standard Development repair task from the
  frozen packet.
- Task 020 must own retry, repair, retest, regression, closure, reopen, and
  break-loop lifecycle history.

## Scope Deviations

- Scope was corrected to include the public Kernel export, package-boundary
  assertion, failure-packet schema evolution, schema/cross-reference
  regressions, and lifecycle artifacts required by the reviewed contract.
- Direct acceptance ownership was narrowed to the frozen packet and six
  classifications. Task 018 contributes to `AC-06`, `AC-25`, and `AC-27`
  without claiming their downstream workflow closure.
- The four pre-existing CodeGraph runtime JSON files remain outside this task.

## Follow-up Needed

- Task 019 continues the Failure Repair Loop with the Development repair
  bridge.

## Adjudication

All original RED receipts and blocked reviews remain append-only. Later
system-executed receipts and final independent re-reviews prove the repairs
without erasing failed evidence. No fallback or simplified verification path
was introduced. Completed-state lifecycle checks leave 47 legitimate
downstream blockers active.
