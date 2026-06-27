---
name: specnav-status
description: Use this skill when the user asks for SpecNav status, current OpenSpec state, active change, blockers, ready actions, risk tier, stale verification state, or what can legally happen next.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Status

## Purpose

Report current SpecNav and OpenSpec state without changing project artifacts.

## Workflow

1. Run `node "$SPECNAV_CORE_ROOT/scripts/workflow-state.js" --json`.
2. Run `node "$SPECNAV_CORE_ROOT/scripts/affordances.js" --markdown`.
3. Report active change, stage, risk tier, verification freshness, ready actions, and blockers.
4. Treat chat history and previous summaries as claims unless current files or scripts confirm them.

## Required Outputs

- A concise status response.
- Runtime state files under `openspec/.specnav/` only when scripts write them.

## Stop Conditions

- `workflow-state.js` fails.
- `affordances.js` fails.
- OpenSpec is missing and only initialization or repair actions are legal.

## Validation

- Both commands must succeed or their exact blockers must be reported.
