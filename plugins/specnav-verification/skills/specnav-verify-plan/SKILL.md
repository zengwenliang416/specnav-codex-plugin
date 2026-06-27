---
name: specnav-verify-plan
description: Use this skill when SpecNav development is complete and the user wants a six-domain verification plan, evidence index, traceability matrix, blocker classification, root-cause checks, behavior evals, or receipt shell.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verify Plan

## Purpose

Create shared verification plan and evidence contracts.

## Workflow

1. Run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json` first.
2. If blocked, route to development.
3. Read `references/verification-model.md` before planning domains.
4. Read `references/domain-report-schema.md` before creating report shells.
5. Read `references/review-report-style.md` before final aggregate reporting.
6. If shared verification artifacts are missing, run `node "$SPECNAV_VERIFICATION_ROOT/skills/specnav-verify-plan/scripts/create-verify-plan.js" --json`.
7. Write verification plan, evidence index, traceability matrix, blocker classification, root-cause checks, behavior evals, and receipt shell.
8. Require all six domains: facticity, static, unit, redteam, e2e, and sensory.
9. After all domain reports exist, run aggregate and make sure HTML review reports are written.

## Required Outputs

- `verify/plan.md`, `plan.json`, `evidence-index.jsonl`, `traceability-matrix.json`, `blocker-classification.jsonl`, `root-cause-checks.jsonl`, behavior eval files, and receipt shell.
- `verify/aggregate-report.html` and change-level `verify-report.html` for stakeholder review.
- Shared shells: `assets/plan.md`, `assets/plan.json`, `assets/evidence-index.jsonl`, `assets/traceability-matrix.json`, `assets/blocker-classification.jsonl`, `assets/root-cause-checks.jsonl`, `assets/receipt.md`, `assets/receipt.json`, `assets/behavior-evals/scenarios.json`, `assets/behavior-evals/report.md`, `assets/behavior-evals/report.json`, and `assets/behavior-evals/transcripts/verify-runs-six-domains.md`.

## Stop Conditions

- Development handoff is blocked.
- Active change is unclear.
- Any required domain is omitted.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json` after writing the domain report.
