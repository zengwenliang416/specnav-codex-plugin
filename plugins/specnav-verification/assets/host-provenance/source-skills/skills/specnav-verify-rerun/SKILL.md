---
name: specnav-verify-rerun
description: Use this skill when a SpecNav verification report is stale after a fix and the exact repaired, impacted, stale, and mandatory baseline cases must be selected before retest or regression.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Rerun

## Purpose

Select exact case-level retest and regression scope after a stale marker or
repair. Domain names remain compatibility metadata and never replace concrete
case ids.

## Workflow

1. Run the V2 adapter `validate` action against the exact approved snapshot.
   Freshness or open-failure blockers mean rerun planning is required.
2. For every new open failure, classify the immutable root packet from an
   approved root-cause check:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
     repair-classify --project "$PWD" --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --failure-id "<failure-id>" \
     --root-cause-check "openspec/changes/<change-id>/verify/root-cause-check.json" \
     --json
   ```

   Classification is immutable and replayable. A conflicting second
   classification blocks instead of replacing the first one.
3. For `product_defect` or `test_defect`, create the Development repair packet:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
     repair-request --project "$PWD" --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --failure-id "<failure-id>" \
     --scope "openspec/changes/<change-id>/scope.json" \
     --json
   ```

   Replaying this command must not overwrite task reports or review files.
4. Before editing any repair source, record the clean repair baseline:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
     repair-start --project "$PWD" --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --failure-id "<failure-id>" \
     --json
   ```

   Commit the generated baseline artifacts before changing repair source.
   `repair-start` is replay-safe, requires a clean Git worktree, and permits
   the repair only when the current code, test, runtime, environment, case,
   and Kernel fingerprints still exactly match the original failed attempt.
   It never replaces the requested link's `before_identity`. If any field
   drifted, preserve the historical incident and run current verification to
   create a new failure before requesting another repair.
5. After the scoped repair is committed and independent spec and quality
   reviews are approved, complete the repair:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
     repair-complete --project "$PWD" --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --failure-id "<failure-id>" \
     --spec-review "openspec/changes/<change-id>/development/tasks/<task-id>/spec-review.json" \
     --quality-review "openspec/changes/<change-id>/development/tasks/<task-id>/quality-review.json" \
     --json
   ```

   `repair-complete` compares the baseline commit with the reviewed commit.
   Every non-lifecycle changed file must be covered by the approved scope lock.
   Denied files, deletes, renames, empty diffs, runtime drift, environment
   drift, case-contract drift, or unreviewed changes block. Test repairs must
   change `test_sha`; product repairs must change `code_sha`.
6. Require `verify/v2/case-snapshot.json`, `verify/v2/case-approval.json`,
   `verify/v2/requirements-source.json`, `verify/v2/acceptance-source.json`,
   `verify/v2/freshness.json`, `verify/rerun-policy.json`, and
   `verify/traceability-matrix.json`. If CodeGraph impact is used, require a
   valid `codegraph/impact-report.json`.
7. Persist the trusted repaired, impacted, and baseline scope:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
     repair-rerun-plan --project "$PWD" --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --failure-id "<failure-id>" \
     --json
   ```

   This uses the same authority as
   `node "$SPECNAV_VERIFICATION_ROOT/scripts/rerun-scope.js" --json`.
   `required_cases` and `reasons_by_case` are authoritative. Never replace
   them with a manually chosen domain list.
   Pass `--reviewer-id <authenticated-human-id>` so the current approval is
   revalidated against the current snapshot and source hashes.
8. If the result is blocked, stop. Unknown references, missing freshness,
   malformed CodeGraph evidence, and unmapped production changes may expand
   scope but may never silently shrink it.
9. Task 020 executes the returned cases as retest or regression attempts.
   Preserve prior failed attempts and evidence; do not edit the stale marker
   by hand.
10. Execute every returned case through the V2 `execute` action using the
   required retry, retest, or regression identity. Never overwrite the first
   failed attempt.
   - Retry uses the original run and requires unchanged fingerprints:

     ```bash
     node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
       execute --project "$PWD" --change "<change-id>" \
       --reviewer-id "<authenticated-human-id>" --case "<case-id>" \
       --attempt-kind retry --parent-attempt "<failed-attempt-id>" --json
     ```

   - Retest and regression each create a new run with immutable parent lineage:

     ```bash
     node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
       execute --project "$PWD" --change "<change-id>" \
       --reviewer-id "<authenticated-human-id>" --case "<case-id>" \
       --attempt-kind retest --parent-attempt "<failed-attempt-id>" \
       --failure-id "<failure-id>" --json

     node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
       execute --project "$PWD" --change "<change-id>" \
       --reviewer-id "<authenticated-human-id>" --case "<regression-case-id>" \
       --attempt-kind regression --parent-attempt "<retest-attempt-id>" \
       --failure-id "<failure-id>" --json
     ```
11. Evaluate the repair state after each retest or regression batch:

    ```bash
    node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
      repair-evaluate --project "$PWD" --change "<change-id>" \
      --reviewer-id "<authenticated-human-id>" \
      --failure-id "<failure-id>" \
      --json
    ```

    Continue only with the exact Core-owned transition proposal. Never set a
    failure status by hand.
12. Apply `close_failure`, `reopen_failure`, or `route_break_loop` only after
    explicit user approval:

    ```bash
    node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" \
      repair-transition-apply --project "$PWD" --change "<change-id>" \
      --reviewer-id "<authenticated-human-id>" \
      --failure-id "<failure-id>" \
      --proposal-id "<transition-proposal-id>" \
      --idempotency-key "<stable-application-key>" \
      --approved --json
    ```

    Transition proposals and applications are append-only JSONL facts.
    Repeating the same idempotency key returns the original receipt; a
    conflicting replay blocks.
13. Run the V2 `finalize` action only after every `required_cases` member has
   fresh terminal evidence and all required six-domain readings.

## Required Outputs

- A recorded rerun scope containing `required_cases`, `baseline_cases`,
  `repaired_cases`, `stale_cases`, `reasons_by_case`, CodeGraph refs, and
  policy refs.
- Fresh attempts and readings for every required case.
- `verify/v2/transition-proposals.jsonl`,
  `verify/v2/transition-receipts.jsonl`, and rebuildable
  `verify/v2/failure-state.json`.
- Refreshed aggregate, release/archive gates, report model, and render manifest
  derived from those case readings.

## Stop Conditions

- The case snapshot, exact human approval, current requirements/acceptance
  sources, authenticated reviewer identity, freshness facts, rerun policy,
  plan, root-cause checks, or traceability matrix is missing.
- CodeGraph is required by policy but impact evidence is missing, stale,
  blocked, or cannot map affected files to approved cases.
- A required rerun command cannot run.
- A re-run domain is not green, so the stale marker must remain.

## Validation

- Run V2 `validate`, then `finalize`, and confirm freshness is `fresh`, open
  failure and repair IDs are empty, both gates pass, and `fallback_used` is
  `false`.
