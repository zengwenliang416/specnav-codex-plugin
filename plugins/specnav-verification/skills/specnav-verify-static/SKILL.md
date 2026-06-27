---
name: specnav-verify-static
description: Use this skill when SpecNav needs static analysis, OpenSpec validation, lint, type checks, schema checks, dependency checks, banned-pattern scans, or structural validation for a completed change.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Static

## Purpose

Run static and structural verification declared by the plan.

## Workflow

1. Read `verify/plan.json`.
2. Read `references/static-rubric.md` before choosing static commands.
3. Run every required static command.
4. Include OpenSpec validation, lint, type checks, dependency checks, schema checks, and banned-pattern scans when applicable.
5. Use `assets/report.md` and `assets/report.json` as shells when the domain report is missing.
6. If a required tool is unavailable, record blocker class `tool-unavailable`.

## Required Outputs

- `verify/static/commands.jsonl`, `report.md`, and `report.json`.
- Report shells: `assets/report.md` and `assets/report.json`.

## Stop Conditions

- Plan is missing.
- A required command cannot run.
- Static evidence is incomplete.
- A missing required check would be downgraded to a warning.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json` after writing the domain report.
