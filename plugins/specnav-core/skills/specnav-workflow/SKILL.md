---
name: specnav-workflow
description: Use this skill when the user wants to start, continue, or understand the SpecNav OpenSpec lifecycle, including use SpecNav, continue, next step, requirements, prototype, implement, verify, release, archive, or inspect legal actions.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Workflow

## Purpose

Control the top-level SpecNav lifecycle and keep work inside the installed multi-plugin suite.

## Workflow

1. Run `node "$SPECNAV_CORE_ROOT/scripts/specnav-route.js" --intent "$INTENT" --json`.
2. Treat the JSON fields `target_plugin`, `command`, `skill`, `required_plugins`, `blockers`, `confirmation_required`, and `no_fallback` as authoritative.
3. If `blockers` is non-empty, report the exact blocker list and stop.
4. If `confirmation_required` is true, ask before handoff.
5. Route through the reported stage command and owning skill. Do not use a core fallback implementation when `no_fallback` is true.

## Required Outputs

- No production artifact is written by this skill.
- Return selected stage, target plugin, ready action, blockers, and the exact next command.

## Stop Conditions

- OpenSpec is missing and `-bootstrap` has been reported as the next command.
- The core plugin or target plugin cannot be resolved.
- The router blocks the requested action.
- The user asks to skip a required stage gate.

## Validation

- `specnav-route.js` must return `ok: true` before handoff.
