---
name: specnav-verify-unit
description: Use this skill when SpecNav needs focused unit, regression, edge-case, empty-state, error-path, boundary-input, or test-quality verification for changed production behavior.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Unit

## Purpose

Validate behavior-facing unit and regression coverage.

## Workflow

1. Read plan, user-approved test cases, domain-case matrix, development reports, changed-file traceability, and tests.
2. Read `references/unit-rubric.md` before assessing test quality.
3. Confirm public behavior coverage for critical paths and edge cases named by the approved user test cases.
4. Reject tests coupled to private methods, implementation-only mocks, or collaborator call counts.
5. Use `assets/report.md` and `assets/report.json` as shells when the domain report is missing.
6. Record coverage quality and gaps.

## Required Outputs

- `verify/unit/test-map.json`, `test-quality-rubric.json`, `coverage-notes.md`, `report.md`, and `report.json`.
- Report shells: `assets/report.md` and `assets/report.json`.

## Stop Conditions

- Changed behavior has no meaningful coverage.
- Tests cannot run.
- User test cases are missing, unsigned, or not mapped to unit checks.
- Assertions verify implementation details rather than behavior.

## Validation

- Confirm every unit assertion is approved, terminal, fresh, and evidence
  bound.
- Run the V2 adapter `validate` action. V1 `verify-domains.js` output cannot
  satisfy the Verification 2.0 gate.
