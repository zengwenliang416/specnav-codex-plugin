---
name: specnav-rollback
description: Use this skill when SpecNav needs rollback planning, rollback triggers, exact rollback command or manual step, migration reversal, data recovery notes, or rollback verification for a release with deploy risk.
disable-model-invocation: true
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Rollback

## Purpose

Prepare rollback mechanics for deploy-risk targets.

## Workflow

1. Use for any release target with deploy risk.
2. Read `references/rollback-plan.md` before writing rollback mechanics.
3. If rollback is impossible, require explicit risk acceptance in `operations/signoff.yaml`.
4. Use `assets/rollback-plan.md` as the shell when the artifact is missing.
5. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing.

## Required Outputs

- `operations/rollback-plan.md`.
- Rollback shell: `assets/rollback-plan.md`.

## Stop Conditions

- Rollback is impossible without signoff.
- Data recovery is unknown.
- Rollback verification cannot be documented.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
