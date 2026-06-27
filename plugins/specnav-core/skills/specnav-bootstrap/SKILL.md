---
name: specnav-bootstrap
description: Use this skill when SpecNav reports missing-openspec, the user asks to initialize OpenSpec, bootstrap a project, repair a missing openspec directory, or asks what command to call before requirements can begin.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Bootstrap

## Purpose

Initialize OpenSpec for the target project and write the minimal SpecNav runtime state needed for the rest of the lifecycle to become available.

## Workflow

1. Run `node "$SPECNAV_CORE_ROOT/scripts/specnav-bootstrap.js" --json`.
2. If the command returns `ok: true`, report `status`, `project_root`, `workflow_state`, and `next_actions`.
3. If the command returns `ok: false`, report the exact `blockers` and exit status.
4. Do not load requirements, prototype, development, verification, or operations skills during bootstrap.

## Required Outputs

- A concise bootstrap result.
- The exact next command list from `next_actions`.

## Stop Conditions

- `openspec` CLI is missing.
- `openspec init` fails.
- OpenSpec initialization does not create `openspec/`.
- The user asks to skip bootstrap and continue production work anyway.

## Validation

- Bootstrap succeeds only when `openspec/` exists and `openspec/.specnav/workflow-state.json` is written.
