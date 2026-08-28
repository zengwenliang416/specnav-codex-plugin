---
name: specnav-break-loop
description: Use this skill when a SpecNav development task repeatedly fails review, debug, or fix without progress, when the same blocker recurs across re-dispatches, or when a repeated-failure loop must be classified and escalated instead of retried again.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Break Loop

## Purpose

Stop a repeated-failure loop, classify why the task cannot close, and escalate to the owning decision.

## Workflow

1. Run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json` to confirm the active change and stalled task. Enter this skill automatically when the contract reports `loop-detected:<task>` or `attempt-budget-exhausted:<task>`.
2. Read the matching `loops[]` entry, `task-ledger.jsonl`, the task `report.md`, and the review files. Treat `blocker_digest`, `consecutive_failures`, `attempt_count`, and `next_action` as authoritative routing evidence.
3. Classify the loop cause: task too large, plan wrong, or scope missing.
4. For a task that is too large, split it into smaller vertical slices through `specnav-vertical-slices`.
5. For a wrong plan, route back to the task brief and tasks ordering; for missing scope, route to `specnav-scope-lock`; for a missing spec or product decision, route to the owning upstream skill.
6. Record the classification and escalation decision; do not rerun or re-dispatch the same failing task unchanged.
7. SpecNav must not force a blocked or looping task through implementation.

## Required Outputs

- The loop classification and escalation decision recorded in the task `report.md`.
- Updated `development/task-ledger.jsonl` reflecting the break-loop decision.

## Stop Conditions

- Entry blockers remain.
- The recurring cause cannot be classified from files, tests, logs, or ledger history.
- Escalation needs a missing product, architecture, data-flow, scope, or spec decision.
- The contract still reports a loop after an unchanged rerun. Stop instead of consuming another attempt.

## Validation

- Rerun `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json` and confirm the recorded escalation matches the contract's blocked status.
