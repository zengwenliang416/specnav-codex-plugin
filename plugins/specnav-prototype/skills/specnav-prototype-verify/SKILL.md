---
name: specnav-prototype-verify
description: Use this skill when a SpecNav prototype exists and must be checked before approval, including runnable HTML review, logic-state execution, API examples, data-flow transitions, component seam review, verifier-report.json, or prototype runtime evidence.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Prototype Verify

## Purpose

Verify that the selected prototype branch exists, runs, and exposes reviewable states.

## Workflow

1. Run `node "$SPECNAV_PROTOTYPE_ROOT/scripts/prototype-contract.js" --json` first.
2. Read `prototype/prototype-manifest.json` and verify only the declared branch and entry.
3. Read `references/prototype-verification.md` before writing verifier evidence.
4. For `ui-html`, inspect `visual-inventory.json` before screenshots. Verify that the HTML mirrors the current project shell and does not use a generic review canvas.
5. For `ui-html`, inspect desktop, mobile, variants, tweaks, theme modes, locales, and loading, empty, error, disabled, permission, and populated states.
6. For other branches, run the declared harness or inspect concrete schemas, transitions, and public APIs.
7. Use `assets/verifier-report.json` as the report shell when the file is missing.
8. Write `prototype/verifier-report.json` with green, red, or blocked status and evidence.

## Required Outputs

- `openspec/changes/<active-change>/prototype/verifier-report.json`.
- Supporting logs or screenshots named by the report.
- Report shell: `assets/verifier-report.json`.

## Stop Conditions

- Manifest is invalid.
- Declared entry is missing.
- Runtime execution fails.
- Direct verification evidence cannot be produced.

## Validation

- Rerun `node "$SPECNAV_PROTOTYPE_ROOT/scripts/prototype-contract.js" --json` after writing `verifier-report.json`.
