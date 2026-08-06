---
name: specnav-verify-e2e
description: Use this skill when SpecNav needs end-to-end, user journey, business flow, frontend-backend, API, state, database, integration, or realistic data validation for a completed change.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify E2E

## Purpose

Validate complete user and business flows across boundaries.

## Workflow

1. Read plan, user-approved test cases, domain-case matrix, data-flow specs, requirements, prototype handoff, and development handoff.
2. Read `references/e2e-rubric.md` before selecting flows.
3. Use realistic data and execute the approved user test cases as representative flows.
4. Start the actual runtime surface required by the project, run browser automation or an equivalent user-visible browser check, and record both results in `verify/runtime-evidence.json`.
5. If `development/migrations/manifest.json` has `required=true`, run database verification queries and add a passing `database` surface to `verify/runtime-evidence.json`.
6. Record screenshots, traces, logs, database query refs, or explicit blocked evidence when execution is impossible.
7. Use `assets/report.md` and `assets/report.json` as shells when the domain report is missing.
8. Check frontend, backend, API, state, database, and integration effects together.

## Required Outputs

- `verify/e2e/flows.json`, `run-log.jsonl`, `report.md`, and `report.json`.
- Report shells: `assets/report.md` and `assets/report.json`.

## Stop Conditions

- Environment cannot safely run.
- User test cases are missing, unsigned, or not mapped to E2E flows.
- Flow preconditions are unknown.
- Required data contracts are missing.
- Runtime or browser evidence is missing from `verify/runtime-evidence.json`.
- Database migration is required but no database verification surface exists.

## Validation

- Confirm each E2E flow is an approved command, Playwright, or Midscene case
  with deterministic assertions and bound runtime artifacts.
- Run the V2 adapter `validate` action. V1 `verify-domains.js` output cannot
  satisfy the Verification 2.0 gate.
