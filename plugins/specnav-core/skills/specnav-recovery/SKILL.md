---
name: specnav-recovery
description: Use this skill when SpecNav is stuck in a repeated loop, repeats a failed gate, keeps asking the same question, has conflicting stage artifacts, or needs a safe recovery route without bypassing OpenSpec evidence.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Recovery

## Purpose

Break repeated SpecNav loops by naming the blocker and routing to the smallest valid repair.

## Workflow

1. Collect state with `node "$SPECNAV_CORE_ROOT/scripts/workflow-state.js" --json`.
2. Collect legal actions with `node "$SPECNAV_CORE_ROOT/scripts/affordances.js" --markdown`.
3. Identify the loop type: repeated question, repeated validation failure, stale change, missing artifact, contradictory artifact, or missing plugin.
4. Choose one owning stage and one repair artifact.
5. Ask one focused user question only when a decision is actually needed.

## Required Outputs

- A recovery route, blocker classification, or minimum repaired artifact.

## Stop Conditions

- OpenSpec is missing.
- The owning plugin is missing.
- The repair requires unresolved user input.
- A stage would be marked complete without its gate.

## Validation

- Recovery succeeds only when the repeated command no longer reports the same blocker or the exact unresolved blocker is documented.
