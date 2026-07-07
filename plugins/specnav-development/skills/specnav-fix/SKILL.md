---
name: specnav-fix
description: Use this skill when a SpecNav development task has a spec-review or quality-review verdict of needs-fix, when required fixes remain, or when the review loop must re-run until spec review and quality review are both approved.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Fix

## Purpose

Drive the review fix-loop for a single task until spec review and quality review are both approved.

## Workflow

1. Run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json` to confirm the active change and task.
2. Read the failing `spec-review.md` and `quality-review.md` and collect the Required Fixes verbatim.
3. Apply only the Critical and Important fixes the review demands; verify each reviewer suggestion against files, tests, and logs before applying it.
4. Update `report.md`, then re-run spec review by invoking `specnav-task-review` — reviews run in an isolated verifier context, never in this implementation session. Spec review must reach approved before quality review runs.
5. Re-run quality review (again via `specnav-task-review`) after spec review is approved; loop spec-fix and quality-fix until both verdicts are approved. An approved spec review must cite verified acceptance assertion ids when `acceptance.json` exists.
6. Record each pass in `task-ledger.jsonl` and the supporting evidence in `validation-log.jsonl`. No fallback around a failed review is allowed.
7. If a required fix needs a new product, architecture, data-flow, scope, or spec decision, stop and route upstream instead of re-running review.

## Required Outputs

- Updated `development/tasks/<task-id>/report.md`, `spec-review.md`, and `quality-review.md` with approved verdicts.
- Updated `development/task-ledger.jsonl` and `development/validation-log.jsonl`.

## Stop Conditions

- Entry blockers remain.
- A required fix exceeds scope or needs an upstream decision.
- A reviewer suggestion cannot be verified from files, tests, logs, or runtime state.
- The loop repeats without progress; hand off to `specnav-break-loop`.

## Validation

- Run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json` and proceed only when review and ledger blockers are gone.
