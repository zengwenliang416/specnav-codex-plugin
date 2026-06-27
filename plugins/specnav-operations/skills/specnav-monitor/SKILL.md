---
name: specnav-monitor
description: Use this skill when SpecNav needs post-release monitoring, logs, metrics, endpoints, queues, user flows, observation window, owner, normal values, or escalation route.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Monitor

## Purpose

Prepare monitoring and escalation after release or deploy.

## Workflow

1. Use for deploy or runtime release targets.
2. Read `references/monitor-plan.md` before writing monitoring.
3. If monitoring is impossible, require explicit risk acceptance in `operations/signoff.yaml`.
4. Use `assets/monitor-plan.md` as the shell when the artifact is missing.
5. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing.

## Required Outputs

- `operations/monitor-plan.md`.
- Monitor shell: `assets/monitor-plan.md`.

## Stop Conditions

- Signals are missing.
- Owner is missing.
- Observation window is missing.
- Escalation route is missing and no signoff exists.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
