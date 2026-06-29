---
name: specnav-prototype
description: Use this skill when the user wants a runnable SpecNav prototype, visual review artifact, UI HTML mock, logic-state harness, API contract mock, data-flow harness, or component seam comparison after requirements pass.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Prototype

## Purpose

Create isolated, runnable prototype artifacts that answer a specific design or behavior question before production development.

## Workflow

1. Run `node "$SPECNAV_PROTOTYPE_ROOT/scripts/prototype-contract.js" --json` first.
2. If requirements are blocked, report exact blockers. There is no fallback to generic design or a guessed change.
3. Classify the prototype question before writing code.
4. Read `references/prototype-branches.md` before choosing the branch.
5. Read `references/prototype-artifacts.md` before creating prototype files.
6. Branch Classification: use `ui-html`, `logic-state`, `api-contract`, `data-flow`, or `component-seam`.
7. If starting from templates, run `node "$SPECNAV_PROTOTYPE_ROOT/skills/specnav-prototype/scripts/create-prototype.js" --branch=<branch> --json`.
8. Write artifacts only under `openspec/changes/<active-change>/prototype/`.
9. Expose stable review anchors. For `ui-html`, use `data-specnav-screen`, `data-specnav-component`, `data-specnav-state`, and `data-specnav-variant`; `artifact/index.html` must include at least one `data-specnav-screen` anchor.
10. Set `prototype-manifest.json.ui_capabilities` from the approved requirements. Add `data-specnav-theme-control` or `data-specnav-locale-control` only when the manifest says the prototype includes those controls.
11. Rerun the contract before moving to verification.

## Required Outputs

- `prototype/question.md`.
- `prototype/prototype-manifest.json`.
- Branch code or harness.
- Branch review maps such as `screen-map.json`, `component-tree.md`, or `data-flow-map.md`.
- Branch starters: `assets/question.md`, `assets/prototype-manifest.json`, `assets/screen-map.json`, `assets/ui-html/index.html`, `assets/ui-html/styles.css`, `assets/ui-html/app.js`, `assets/logic-state/harness.js`, `assets/api-contract/examples.json`, `assets/data-flow/data-flow-map.md`, `assets/data-flow/data-flow/flow-harness.js`, `assets/component-seam/component-tree.md`, and `assets/component-seam/component/component-map.md`.

## Stop Conditions

- Requirements are invalid.
- Required design, API, route, state, screenshot, brand, or domain context is missing.
- Branch classification is unclear.
- The prototype would edit production code.

## Validation

- Run `node "$SPECNAV_PROTOTYPE_ROOT/scripts/prototype-contract.js" --json` and proceed only when blockers are expected next-stage artifacts.
