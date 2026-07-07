---
name: specnav-verify-rerun
description: Use this skill when a SpecNav verification report is marked stale after a fix, when verify-report.stale exists, or when the affected verification domain plus its downstream domains must be selectively re-run before the aggregate can go green again.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Rerun

## Purpose

Selectively re-run the affected verification domain plus downstream domains after a stale marker, then clear it.

## Workflow

1. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json`; a `stale-verify-report` blocker means re-run is required.
2. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/rerun-scope.js" --json` to compute the minimal rerun set deterministically from the git diff and `traceability-matrix.json`. Its `domains_to_rerun` output is authoritative; do not pick domains by judgment. If it reports `full_rerun: true` (unmapped changed files), all six domains rerun and the matrix must be extended to cover the unmapped files.
3. Re-run each domain in `domains_to_rerun` (affected domain first), writing fresh domain reports so they are newer than `verify-report.stale`. Read `verify/plan.json` and `root-cause-checks.jsonl` for the per-domain evidence requirements.
4. Do not re-run unaffected domains and do not edit the stale marker by hand; the aggregate clears it only when the rerun reports are fresh.
5. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" aggregate --json` to recompute the verdict and clear the marker once all required domains are fresh and green.

## Required Outputs

- Refreshed `verify/<domain>/report.md` and `report.json` for the affected domain and downstream domains.
- A recomputed `verify/aggregate-report.json` with `stale` false once the marker is cleared.

## Stop Conditions

- The plan, root-cause checks, or traceability matrix is missing.
- A required rerun command cannot run.
- A re-run domain is not green, so the stale marker must remain.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json` and confirm `stale-verify-report` is gone and the aggregate is green.
