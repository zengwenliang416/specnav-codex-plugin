---
name: specnav-verify-redteam
description: Use this skill when SpecNav must run destructive, adversarial, injection, permission, boundary, abuse, resilience, fuzzing, or hostile-input checks for a completed change.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Redteam

## Purpose

Probe security, robustness, and abuse cases missed by normal tests.

## Workflow

1. Read plan, user-approved test cases, domain-case matrix, architecture specs, data-flow specs, permissions, and development handoff.
2. Read `references/redteam-rubric.md` before designing probes.
3. Design probes appropriate to risk tier for each approved user test case.
4. Classify each failure in `verify/root-cause-checks.jsonl` before routing fixes.
5. Use `assets/report.md` and `assets/report.json` as shells when the domain report is missing.
6. Record destructive test evidence without touching real data unless explicitly approved.

## Required Outputs

- `verify/redteam/threat-model.md`, `probes.jsonl`, `report.md`, and `report.json`.
- Report shells: `assets/report.md` and `assets/report.json`.

## Stop Conditions

- Probes would touch real data without approval.
- Required environment is unavailable.
- User test cases are missing, unsigned, or not mapped to redteam probes.
- Root cause cannot be classified.

## Validation

- Confirm every red-team assertion is approved and retains failed as well as
  passing evidence.
- Run the V2 adapter `validate` action. V1 `verify-domains.js` output cannot
  satisfy the Verification 2.0 gate.
