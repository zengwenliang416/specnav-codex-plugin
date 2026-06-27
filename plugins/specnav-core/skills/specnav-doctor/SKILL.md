---
name: specnav-doctor
description: Use this skill when the user asks to diagnose SpecNav installation, plugin discovery, hook wiring, OpenSpec availability, suite dependency health, command exposure, or why a SpecNav command or skill is unavailable.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Doctor

## Purpose

Diagnose SpecNav installation and runtime surfaces from direct evidence.

## Workflow

1. Run `node "$SPECNAV_CORE_ROOT/scripts/specnav-doctor.js" --json`.
2. Report plugin roots, marketplace root, hook status, OpenSpec status, contract scripts, and blockers.
3. For missing plugins, report `missing-plugin:<name>` and the expected discovery root.
4. For missing hook or command exposure, report the exact path named by doctor evidence.

## Required Outputs

- A doctor report in chat.
- Any runtime diagnostic files written by the doctor script.

## Stop Conditions

- Doctor exits non-zero.
- A required plugin, hook, command, or OpenSpec surface is missing.
- Fresh support evidence is unavailable.

## Validation

- Doctor is valid only with current `specnav-doctor.js --json` output.
