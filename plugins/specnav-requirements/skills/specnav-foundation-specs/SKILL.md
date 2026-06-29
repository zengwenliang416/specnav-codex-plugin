---
name: specnav-foundation-specs
description: Use this skill when SpecNav requirements are blocked by missing or invalid foundation specs, or when the user needs to create or repair UI design, system architecture/database, frontend-backend data flow, or component architecture specs.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Foundation Specs

## Purpose

Create or repair the four project-level foundation specs required before requirements questioning.

## Workflow

1. Run `node "$SPECNAV_REQUIREMENTS_ROOT/scripts/foundation-specs.js" --json` first.
2. If required specs are missing, run `node "$SPECNAV_REQUIREMENTS_ROOT/scripts/repository-discovery.js" --write --json` first and use `openspec/.specnav/context/repository-discovery.json` only as evidence and pending-question input.
3. Discovery findings do not replace the foundation gate; rerun `foundation-specs.js --json` after every foundation edit and proceed only when it passes.
4. Repair only reported blockers for missing sections, frontmatter values, token references, theme parity, component contract shape, YAML parse errors, or `frontmatter_errors`.
5. Required specs are ui-design, system-architecture, frontend-backend-data-flow, and component-architecture.
6. Read `references/foundation-spec-contract.md` before creating or repairing foundation specs.
7. If required specs are missing, run `node "$SPECNAV_REQUIREMENTS_ROOT/skills/specnav-foundation-specs/scripts/create-foundation-specs.js" --json` to create skeletons from `assets/`.
8. If UI design is missing, guide the user to create the supplied Geist-style YAML token contract and Markdown guide.
9. UI design must explicitly record theme capability, theme toggle policy, i18n capability, supported locales, and default locale; do not infer dark mode or language switching from taste.
10. Preserve existing decisions outside reported blockers.

## Required Outputs

- `openspec/specs/ui-design/design.md`.
- `openspec/specs/system-architecture/design.md`.
- `openspec/specs/frontend-backend-data-flow/design.md`.
- `openspec/specs/component-architecture/design.md`.
- Templates are supplied in `assets/ui-design/design.md`, `assets/system-architecture/design.md`, `assets/frontend-backend-data-flow/design.md`, and `assets/component-architecture/design.md`.

## Stop Conditions

- Required project context is absent.
- The user must supply a design or architecture decision.
- The validator remains blocked after exact repairs.

## Validation

- Rerun `node "$SPECNAV_REQUIREMENTS_ROOT/scripts/foundation-specs.js" --json` after each edit and proceed only when `ok` is true.
