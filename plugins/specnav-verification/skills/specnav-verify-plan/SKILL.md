---
name: specnav-verify-plan
description: Use this skill when SpecNav development is complete and the user wants the full Verification 2.0 case contract, explicit case approval, evidence plan, traceability, six-domain execution plan, or report inputs.
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
7. Generate behavior-facing V2 cases from requirements, acceptance, prototype handoff, development tasks, development handoff, and CodeGraph claims. Every case must include steps, assertions, all six domain mappings, runner choice, and evidence policy.
8. Create the immutable case snapshot with:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/skills/specnav-verify-plan/scripts/case-contract.js" snapshot \
     --input "<case-plan-request.json>" \
     --output "<case-snapshot.json>" \
     --json
   ```

9. Ask the user to inspect, edit, add, or remove cases before approval. Approval must be an explicit human decision bound to the current snapshot id and SHA-256 hash.
10. Validate the approval before any execution:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/skills/specnav-verify-plan/scripts/case-contract.js" check \
     --snapshot "<case-snapshot.json>" \
     --approval "<case-approval.json>" \
     --requirements "<current-requirements.json>" \
     --acceptance "<current-acceptance.json>" \
     --reviewer-id "<authenticated-reviewer-id>" \
     --json
   ```

   A changed case, step, assertion, six-domain mapping, runner, source contract, or evidence policy makes the prior approval stale and blocks execution.
11. Map every approved test case across facticity, static, unit, redteam, e2e, and sensory in `verify/domain-case-matrix.json`.
11. Require `verify/runtime-evidence.json` to prove runtime and browser execution for standard/full lanes. If `development/migrations/manifest.json` has `required=true`, require database evidence too.
12. Ensure `openspec/changes/<change>/codegraph/claims-map.json` and `evidence-query-plan.json` include verification traceability claims. The `create-verify-plan.js` scaffold writes these automatically; re-run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-plan.js" --stage verification --write --json` after changing development handoff or verify scope.
13. Write verification plan, evidence index, traceability matrix, blocker classification, root-cause checks, behavior evals, and receipt shell.
15. Require all six domains for every change: facticity, static, unit, redteam, e2e, and sensory. Verification 2.0 has no light, compact, or simplified lane.
15. Every file in `plan.changed_files` must appear in `traceability-matrix.json`; do not mark verification green from stale reports that are not tied to the diff.
16. After every approved case has terminal six-domain readings, run the V2
    `finalize` action. It derives freshness, integrity, aggregate, release and
    archive decisions, the report model, render manifest, and all three HTML
    pages from persisted facts.

## Required Outputs

- `verify/plan.md`, `plan.json`, `evidence-index.jsonl`, `traceability-matrix.json`, `blocker-classification.jsonl`, `root-cause-checks.jsonl`, behavior eval files, and receipt shell.
- `verify/user-test-cases.md`, `user-test-cases.json`, `user-test-case-signoff.json`, and `domain-case-matrix.json`.
- `verify/runtime-evidence.json` with runtime, browser, and any required database evidence for standard/full lanes.
- `codegraph/claims-map.json` and `codegraph/evidence-query-plan.json` with verification traceability claims.
- `verify/v2/gate-input.json`, `release-gate.json`, `archive-gate.json`,
  `report-model.json`, and `report-render-manifest.json`.
- `verify/reports/overview.html`, `test-case-catalog.html`, and
  `test-case-results.html` as stakeholder projections.
- Shared shells: `assets/plan.md`, `assets/plan.json`, `assets/user-test-cases.md`, `assets/user-test-cases.json`, `assets/user-test-case-signoff.json`, `assets/domain-case-matrix.json`, `assets/runtime-evidence.json`, `assets/evidence-index.jsonl`, `assets/traceability-matrix.json`, `assets/blocker-classification.jsonl`, `assets/root-cause-checks.jsonl`, `assets/receipt.md`, `assets/receipt.json`, `assets/behavior-evals/scenarios.json`, `assets/behavior-evals/report.md`, `assets/behavior-evals/report.json`, and `assets/behavior-evals/transcripts/verify-runs-six-domains.md`.

## Stop Conditions

- Development handoff is blocked.
- Active change is unclear.
- User-aligned V2 test cases are missing, schema-invalid, incompletely mapped, or not explicitly approved by a human for the current snapshot hash.
- `verify/runtime-evidence.json` is missing, blocked, or lacks the runtime, browser, or database surfaces required by a standard/full change.
- `plan.changed_files` is empty or not mapped in `traceability-matrix.json`.
- Any of the six required domains is omitted.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" validate --project "$PWD" --change "<change-id>" --reviewer-id "<authenticated-human-id>" --json`.
- `verify-domains.js` is only the explicit `legacy-validate` path for V1
  migration diagnostics; it is not a Verification 2.0 gate.
