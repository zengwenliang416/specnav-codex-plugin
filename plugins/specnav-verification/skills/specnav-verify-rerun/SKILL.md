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
2. Require `verify/v2/case-snapshot.json`, `verify/v2/case-approval.json`,
   `verify/v2/requirements-source.json`, `verify/v2/acceptance-source.json`,
   `verify/v2/freshness.json`, `verify/rerun-policy.json`, and
   `verify/traceability-matrix.json`. If CodeGraph impact is used, require a
   valid `codegraph/impact-report.json`.
3. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/rerun-scope.js" --json`.
   `required_cases` and `reasons_by_case` are authoritative. Never replace
   them with a manually chosen domain list.
   Pass `--reviewer-id <authenticated-human-id>` so the current approval is
   revalidated against the current snapshot and source hashes.
4. If a product or test repair is being verified, pass every repaired case
   explicitly with `--repaired <case-id,...>`.
5. If the result is blocked, stop. Unknown references, missing freshness,
   malformed CodeGraph evidence, and unmapped production changes may expand
   scope but may never silently shrink it.
6. Task 020 executes the returned cases as retest or regression attempts.
   Preserve prior failed attempts and evidence; do not edit the stale marker
   by hand.
7. Execute every returned case through the V2 `execute` action using the
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
8. Run the V2 `finalize` action only after every `required_cases` member has
   fresh terminal evidence and all required six-domain readings.

## Required Outputs

- A recorded rerun scope containing `required_cases`, `baseline_cases`,
  `repaired_cases`, `stale_cases`, `reasons_by_case`, CodeGraph refs, and
  policy refs.
- Fresh attempts and readings for every required case.
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
