---
name: specnav-route
description: Use this skill when the user asks SpecNav to route an ambiguous request, continue a stage, choose the next legal lifecycle action, or translate product intent into the correct SpecNav plugin command without bypassing OpenSpec gates.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Route

## Purpose

Route user intent to the right SpecNav plugin while preserving dependency checks.

## Workflow

1. Run `node "$SPECNAV_CORE_ROOT/scripts/specnav-route.js" --intent "$INTENT" --json`.
2. Treat the router JSON as authoritative: `target_plugin`, `command`, `skill`, `required_plugins`, `triage`, `blockers`, `confirmation_required`, and `no_fallback`.
3. If `blockers` is non-empty, report the exact blockers and stop.
4. If `confirmation_required` is true, ask before handoff.
5. If `no_fallback` is true, do not use a monolithic core lifecycle fallback.

The router itself runs `plugin-suite.js`, `affordances.js`,
`change-triage.js`, and, for foundation routes, `foundation-specs.js`.

Routing order:

1. Missing OpenSpec or ready bootstrap action -> `specnav-core`, `-bootstrap`, `specnav-bootstrap`.
2. Repository discovery -> foundation -> requirements. Project standards, foundation specs, complete specs, UI design, system architecture, frontend-backend data flow, component architecture, architecture constraints, and development conventions route to `specnav-requirements`, `-requirements`, and `specnav-foundation-specs`; the JSON also reports the discovery step before foundation work.
3. Simple docs, copy, label, comment, README, or low-risk style/config changes
   with `triage.lane: "light"` -> `specnav-development`,
   `$specnav-light-change`, `specnav-light-change`.
4. DEFINE or REQUIREMENTS -> `specnav-requirements`, `-requirements`, `specnav-requirements`.
5. PROTOTYPE -> `specnav-prototype`, `-prototype`, `specnav-prototype`.
6. BUILD -> `specnav-development`, `-development-entry`, `specnav-development-entry`.
7. FIX -> `specnav-development`, `-development-entry`, `specnav-fix`.
8. CHECK or VERIFICATION -> `specnav-verification`, `$specnav-verification`,
   `specnav-verification`.
9. RELEASE -> `specnav-operations`, `-release-plan`, `specnav-release-plan`.
10. ARCHIVE -> `specnav-operations`, `-branch-finish`, `specnav-branch-finish`.

Existing `openspec/specs/development-conventions/*` files do not satisfy foundation specs by themselves. The route remains `specnav-foundation-specs` until `ui-design`, `system-architecture`, `frontend-backend-data-flow`, and `component-architecture` all pass `foundation-specs.js`.

## Required Outputs

- No lifecycle artifacts are written.
- Return the target plugin, command, blockers, and next legal action.
- Return `triage.lane`, `triage.confidence`, and escalation triggers when the request is simple enough for light lane.
- When OpenSpec is missing, the required output must name `-bootstrap`.
- When foundation specs are missing or invalid, the required output must name `specnav-foundation-specs` and list the exact foundation-spec blockers.

## Stop Conditions

- The target plugin is missing.
- The requested action is not legal.
- A required upstream artifact is blocked.
- A legacy monolithic route would be needed.

## Validation

- The target plugin require command must pass or report the exact blocker.
