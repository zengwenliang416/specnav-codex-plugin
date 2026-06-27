---
name: specnav-postmortem
description: Use this skill when SpecNav verification, release, deploy, rollback, security, data, availability, repeated failure, or risk evidence requires a postmortem and learning capture.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Postmortem

## Purpose

Record operational learning after failures or risk events.

## Workflow

1. Write a postmortem when evidence requires one.
2. Read `references/postmortem.md` before writing learning.
3. Include trigger, root cause, impact, mitigation, follow-up, and whether learning must be written back to OpenSpec.
4. Use `assets/postmortem.md` as the shell when the artifact is missing.
5. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing.

## Required Outputs

- `operations/postmortem.md`.
- Postmortem shell: `assets/postmortem.md`.

## Stop Conditions

- Root cause lacks evidence.
- Impact cannot be described from evidence.
- Required writeback is not classified.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
