---
name: specnav-verify-sensory
description: Use this skill when SpecNav needs independent human-in-the-loop UX, accessibility, maintainability, component cohesion/coupling, performance feel, readability, or final code review beyond automated checks.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Sensory

## Purpose

Run evidence-backed human review that automation cannot fully cover.

## Workflow

1. Stay read-only over production code and verification evidence, including user-approved test cases and the domain-case matrix.
2. Read `references/sensory-rubric.md` before reviewing.
3. Review readability, UX, interaction quality, accessibility, performance feel, maintainability, component cohesion and coupling for each approved user test case.
4. Use `assets/report.md` and `assets/report.json` as shells when the domain report is missing.
5. Tie every finding to a file, artifact, screenshot, command, transcript, or inspection note.
6. Report unverified claims explicitly.

## Required Outputs

- `verify/sensory/reviewer-independence.md`, `review.md`, `findings.jsonl`, `report.md`, and `report.json`.
- Report shells: `assets/report.md` and `assets/report.json`.

## Stop Conditions

- Independence is compromised.
- User test cases are missing, unsigned, or not mapped to sensory review.
- Evidence is missing.
- A finding cannot be tied to concrete evidence.

## Validation

- Confirm sensory findings map to approved assertions and either deterministic
  evidence or an allowed exact human signoff.
- Run the V2 adapter `validate` action. V1 `verify-domains.js` output cannot
  satisfy the Verification 2.0 gate.
