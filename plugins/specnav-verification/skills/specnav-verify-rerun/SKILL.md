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

1. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json`; a `stale-verify-report` blocker means re-run is required.
2. Require `verify/case-snapshot.json`, `verify/case-approval.json`,
   `verify/current-requirements.json`, `verify/current-acceptance.json`,
   `verify/case-freshness.json`, `verify/rerun-policy.json`, and
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
7. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" aggregate
   --json` only after every `required_cases` member has fresh terminal
   evidence and the required six-domain readings.

## Required Outputs

- A recorded rerun scope containing `required_cases`, `baseline_cases`,
  `repaired_cases`, `stale_cases`, `reasons_by_case`, CodeGraph refs, and
  policy refs.
- Fresh attempts and readings for every required case.
- Refreshed domain reports derived from those case readings.
- A recomputed `verify/aggregate-report.json` with `stale` false once the marker is cleared.

## Stop Conditions

- The case snapshot, exact human approval, current requirements/acceptance
  sources, authenticated reviewer identity, freshness facts, rerun policy,
  plan, root-cause checks, or traceability matrix is missing.
- CodeGraph is required by policy but impact evidence is missing, stale,
  blocked, or cannot map affected files to approved cases.
- A required rerun command cannot run.
- A re-run domain is not green, so the stale marker must remain.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json` and confirm `stale-verify-report` is gone and the aggregate is green.
