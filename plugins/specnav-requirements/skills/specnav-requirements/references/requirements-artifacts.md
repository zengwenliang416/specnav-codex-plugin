# Requirements Artifact Contract

Read this before creating or repairing change-level requirements artifacts.

## Files

All files live under `openspec/changes/<active-change>/`.

- `requirements.md`
- `acceptance.md`
- `spec-map.json`
- `component-impact-map.json`

## `requirements.md`

Required content:

- feature summary;
- users and actors;
- in-scope behavior;
- out-of-scope behavior;
- UI design impact;
- architecture/database impact;
- frontend-backend data-flow impact;
- component architecture impact;
- unresolved gaps.

## `acceptance.md`

Acceptance criteria must be behavior-facing and testable. Avoid implementation
tasks here. Each criterion should name the user-visible or system-visible result
and the verification surface.

## `spec-map.json`

Required array fields:

- `touched_specs`
- `ui_rules`
- `architecture_modules`
- `api_contracts`
- `database_entities`
- `permissions`
- `operational_constraints`
- `data_flows`
- `unresolved_gaps`

`touched_specs` may only contain:

- `ui-design`
- `system-architecture`
- `frontend-backend-data-flow`
- `component-architecture`

## `component-impact-map.json`

Required array fields:

- `new_components`
- `reused_components`
- `extraction_triggers`
- `forbidden_dependencies`
- `hooks`
- `utilities`
- `services`
- `required_component_tests`
- `unresolved_gaps`

## Component Constraint

Every feature must state whether it creates, reuses, or extracts components.
If a reusable component, hook, utility, or service should be extracted, do not
hide it in `requirements.md`; record it in `component-impact-map.json`.
