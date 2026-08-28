---
name: specnav-ops-readiness
description: Use this skill when SpecNav needs release or archive readiness, operations blocker aggregation, verification receipt review, git state review, required docs review, or a final ready/not-ready decision.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Ops Readiness

## Purpose

Build the final operations readiness decision.

## Workflow

Before declaring readiness, run the Operations gate:

```bash
node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json
```

Treat every returned blocker as release-blocking. Do not accept legacy green
aggregates, HTML text, light verification, partial-domain evidence, fallback,
or a manual green override. The gate requires cross-host proof only when
`release_target` is `plugin-marketplace` or `host-compatibility`; ordinary
project and package targets validate only the current project's Verification
proof.

1. Read verification aggregate report, receipt, blocker classification, development handoff, `tasks.md`, `development/migrations/manifest.json`, release plan, git state, and operations artifacts.
2. Write readiness from direct evidence only.
3. Read `references/operations-readiness.md` before writing readiness.
4. If readiness artifacts are missing, run `node "$SPECNAV_OPERATIONS_ROOT/skills/specnav-ops-readiness/scripts/create-readiness.js" --release-target=<target> --json`.
5. Run `node "$SPECNAV_CORE_ROOT/scripts/tasks-md.js" normalize --json` before archive/readiness decisions. This converts plain task bullets into standard OpenSpec checkbox tasks.
6. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` before and after edits.
7. Treat `tasks.md` checkbox state as evidence: plain bullets must be normalized first, unchecked tasks are `tasks-md:incomplete-checkboxes`, and no checked task is `tasks-md:no-completed-checkboxes`. Never imply completion from the absence of `- [ ]`.
8. If `development/migrations/manifest.json` has `required=true`, release target must be `project-deploy`, `readiness.json` must set `ops.migrations` to `pass`, and `operations/migration-deployment.json` must record applied migration ids, evidence refs, and rollback refs or strategy.
9. For final archive, run `node "$SPECNAV_OPERATIONS_ROOT/scripts/archive-change.js" --change <change> --json`. Do not manually move `openspec/changes/<change>` or hand-edit `openspec/.specnav/change-registry.json`.

## Required Outputs

- `operations/readiness.md` and `operations/readiness.json`.
- `operations/migration-deployment.json` when `development/migrations/manifest.json` has `required=true`.
- Readiness shells: `assets/readiness.md` and `assets/readiness.json`.

## Stop Conditions

- Verification is not green.
- `tasks.md` has no checkbox tasks, mixed task syntax, unchecked tasks, or no completed checkbox tasks.
- Release target is missing.
- Git state is unknown.
- Required operations artifacts are missing.
- Required migrations are not represented in readiness and migration deployment evidence.
- Archive would require manual directory moves or manual registry edits.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
