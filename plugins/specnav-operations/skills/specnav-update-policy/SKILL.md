---
name: specnav-update-policy
description: Use this skill when SpecNav needs an installation update policy, current-host scoped update rule, all-host explicit request rule, tracked refs, discovery roots, plugin roots, or reload hints.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Update Policy

## Purpose

Record how installed plugin surfaces update and get re-verified.

## Workflow

1. Document every known installation, host, plugin root, discovery root, discovery shape, tracked ref, and reload hint.
2. Read `references/update-policy.md` before writing policy.
3. Default updates are current-host scoped.
4. All-host updates require explicit user request.
5. Use `assets/update-policy.json` as the shell when the artifact is missing.
6. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing.

## Required Outputs

- `operations/update-policy.json`.
- Update policy shell: `assets/update-policy.json`.

## Stop Conditions

- Installation evidence is missing.
- All-host update lacks explicit confirmation.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
