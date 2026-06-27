---
name: specnav-prototype-handoff
description: Use this skill when a verified SpecNav prototype needs explicit user approval, decision.json, required_present status, or a development handoff that freezes approved branch, variant, components, data flows, tests, and risks.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Prototype Handoff

## Purpose

Record explicit prototype approval and produce the development handoff.

## Workflow

1. Run `node "$SPECNAV_PROTOTYPE_ROOT/scripts/prototype-contract.js" --json` before handoff.
2. Stop on requirements, manifest, branch code, entry path, or verifier blockers.
3. Read `references/prototype-approval.md` before asking for approval or writing handoff artifacts.
4. Ask for explicit user approval before setting `status: approved`.
5. Use `assets/handoff.md` and `assets/decision.json` as shells when files are missing.
6. Write `prototype/handoff.md` with branch, variant, screens, flows, components, API contracts, data flows, states, out-of-scope items, required tests, and risks.
7. Write `prototype/decision.json` with `prototype_code: required_present` and `promotion: requires_development_gate`.

## Required Outputs

- `prototype/handoff.md`.
- `prototype/decision.json`.
- Handoff shells: `assets/handoff.md` and `assets/decision.json`.

## Stop Conditions

- User approval is missing.
- Verifier status is not green.
- Handoff topics have unresolved decisions.
- The decision would bypass development gates.

## Validation

- Rerun `node "$SPECNAV_PROTOTYPE_ROOT/scripts/prototype-contract.js" --json` and hand off only when `ok` is true.
