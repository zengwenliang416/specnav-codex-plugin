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

1. Read `verify/plan.json`, `verify/user-test-cases.json`, `verify/user-test-case-signoff.json`, and `verify/domain-case-matrix.json`.
2. Read `references/static-rubric.md` before choosing static commands.
3. Run every required static command.
4. Include OpenSpec validation, lint, type checks, dependency checks, schema checks, banned-pattern scans, and user test case coverage when applicable.
5. Use `assets/report.md` and `assets/report.json` as shells when the domain report is missing.
6. If a required tool is unavailable, record blocker class `tool-unavailable`.
7. Run the L3 anchor coverage scan: `node "$SPECNAV_VERIFICATION_ROOT/scripts/anchor-scan.js" --json`. It is advisory by default (writes `verify/static/anchor-report.json` and an `anchor.coverage` event, never blocks). It only blocks with `anchor-uncovered:<file>` when the optional `ai-annotation-policy` declares `enforcement: gate`. Surface uncovered touched seams in the static report regardless of enforcement level.

## Required Outputs

- `verify/static/commands.jsonl`, `report.md`, and `report.json`.
- Report shells: `assets/report.md` and `assets/report.json`.

## Stop Conditions

- Plan is missing.
- A required command cannot run.
- User test cases are missing, unsigned, or not mapped to static checks.
- Static evidence is incomplete.
- A missing required check would be downgraded to a warning.

## Validation

- Confirm every required static command is represented by approved assertions
  and explicit command-result evidence.
- Run the V2 adapter `validate` action. V1 `verify-domains.js` output cannot
  satisfy the Verification 2.0 gate.
