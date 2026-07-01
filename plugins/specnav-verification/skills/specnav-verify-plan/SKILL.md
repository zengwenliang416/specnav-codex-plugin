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
7. Generate `verify/user-test-cases.md` and `verify/user-test-cases.json` from requirements, acceptance, prototype handoff, development tasks, development handoff, and CodeGraph claims.
8. Ask the user to approve, edit, add, or remove the test cases. Freeze approval in `verify/user-test-case-signoff.json`; six-domain verification is blocked until its status is `approved`.
9. Map every approved test case across all six domains in `verify/domain-case-matrix.json`.
10. Ensure `openspec/changes/<change>/codegraph/claims-map.json` and `evidence-query-plan.json` include verification traceability claims. The `create-verify-plan.js` scaffold writes these automatically; re-run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-plan.js" --stage verification --write --json` after changing development handoff or verify scope.
11. Require `verify/runtime-evidence.json` to prove runtime and browser execution. If `development/migrations/manifest.json` has `required=true`, require database evidence too.
12. Write verification plan, evidence index, traceability matrix, blocker classification, root-cause checks, behavior evals, runtime evidence, and receipt shell.
13. Require all six domains: facticity, static, unit, redteam, e2e, and sensory.
14. Every file in `plan.changed_files` must appear in `traceability-matrix.json`; do not mark verification green from stale reports that are not tied to the diff.
15. After all domain reports exist, run aggregate and make sure HTML review reports are written.

## Required Outputs

- `verify/plan.md`, `plan.json`, `evidence-index.jsonl`, `traceability-matrix.json`, `blocker-classification.jsonl`, `root-cause-checks.jsonl`, behavior eval files, and receipt shell.
- `verify/user-test-cases.md`, `user-test-cases.json`, `user-test-case-signoff.json`, and `domain-case-matrix.json`.
- `verify/runtime-evidence.json` with runtime, browser, and any required database evidence.
- `codegraph/claims-map.json` and `codegraph/evidence-query-plan.json` with verification traceability claims.
- `verify/aggregate-report.html` and change-level `verify-report.html` for stakeholder review.
- Shared shells: `assets/plan.md`, `assets/plan.json`, `assets/user-test-cases.md`, `assets/user-test-cases.json`, `assets/user-test-case-signoff.json`, `assets/domain-case-matrix.json`, `assets/runtime-evidence.json`, `assets/evidence-index.jsonl`, `assets/traceability-matrix.json`, `assets/blocker-classification.jsonl`, `assets/root-cause-checks.jsonl`, `assets/receipt.md`, `assets/receipt.json`, `assets/behavior-evals/scenarios.json`, `assets/behavior-evals/report.md`, `assets/behavior-evals/report.json`, and `assets/behavior-evals/transcripts/verify-runs-six-domains.md`.

## Stop Conditions

- Development handoff is blocked.
- Active change is unclear.
- User-aligned test cases are missing or not approved by the user.
- Any required domain is omitted.
- `verify/runtime-evidence.json` is missing, blocked, or lacks runtime/browser/database surfaces required by the change.
- `plan.changed_files` is empty or not mapped in `traceability-matrix.json`.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json` after writing the domain report.
