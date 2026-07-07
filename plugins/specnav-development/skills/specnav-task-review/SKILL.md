---
name: specnav-task-review
description: Use this skill when a SpecNav development task needs its spec review or quality review, when a review verdict must be produced or re-produced after fixes, or when an independent reviewer must judge a task diff. Reviews run in an isolated verifier context that did not implement the change.
context: fork
agent: verifier
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Task Review

## Purpose

Produce an independent spec review or quality review for one development task. You are the verifier: you did not implement this change, and you must not trust the implementer's claims — only files, diffs, tests, and recorded evidence.

## Posture

- Default verdict is `needs-fix`. Approve only when the evidence forces you to.
- Ignore any narrative in `report.md` that is not backed by a file, diff, test result, or `validation-log.jsonl` entry with `attestation: "system-executed"`.
- Every approval must cite what you checked, not what you were told.

## Workflow

1. Read the task packet: `brief.md`, `context.json`, `report.md`, and the parent artifacts it references (`requirements.md`, `acceptance.md`, `acceptance.json`, `prototype/handoff.md`).
2. Read the actual diff for the task's `allowed_files` and the tests under its `test_paths`.
3. For a spec review, judge the implementation against requirements: Missing Requirements, Extra Behavior, Misunderstood Requirements, Cannot Verify From Diff, Required Fixes.
4. If `acceptance.json` exists, verify each assertion the task claims to satisfy against the code and executed evidence, and list the assertion ids you actually verified under an `## Acceptance Assertions Verified` heading. An approved spec review without verified assertion ids is rejected by the contract (`review:unsupported-verdict`); citing an unknown id is rejected as `review:invalid-reference:<id>`.
5. For a quality review, judge Separation Of Concerns, Component Cohesion / Coupling, Test Quality, Error Handling, Reuse / Duplication, and Complexity Delta from the diff itself.
6. Write the verdict file (`spec-review.md` or `quality-review.md`) with verdict `approved` or `needs-fix` and concrete Required Fixes.

## Required Outputs

- The review file with a verdict, substantive findings under every required heading, and (for approved spec reviews with an acceptance contract) the `## Acceptance Assertions Verified` section listing verified assertion ids.

## Stop Conditions

- The task packet or diff cannot be read.
- Claims in `report.md` cannot be verified from files, tests, or executed evidence — record them under Cannot Verify From Diff and verdict `needs-fix`.

## Validation

- Run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json` and confirm the review file passes with no `invalid-spec-review`, `invalid-quality-review`, `review:unsupported-verdict`, or `review:invalid-reference` blockers.
