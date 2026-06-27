---
name: specnav-verify-facticity
description: Use this skill when SpecNav must audit whether specs, requirements, reports, generated artifacts, dependencies, APIs, routes, config, database effects, or implementation claims match actual repository state.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Facticity

## Purpose

Audit claims against current repository evidence.

## Workflow

1. Read plan, traceability, requirements, foundation specs, prototype handoff, and development handoff.
2. Read `references/facticity-rubric.md` before auditing claims.
3. Treat summaries as claims, not proof.
4. Inventory actual files, APIs, dependencies, config, database effects, and changed behavior.
5. Use `assets/report.md` and `assets/report.json` as shells when the domain report is missing.
6. Write red findings for unmapped changes, invented facts, stale specs, or undocumented behavior.

## Required Outputs

- `verify/facticity/claims.jsonl`, `repo-inventory.json`, `report.md`, and `report.json`.
- Report shells: `assets/report.md` and `assets/report.json`.

## Stop Conditions

- Repository evidence cannot be read.
- Claims are unmapped.
- Specs are stale.
- Implementation behavior is undocumented.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json` after writing the domain report.
