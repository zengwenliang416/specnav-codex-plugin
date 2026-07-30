---
name: specnav-vertical-slices
description: Use this skill when SpecNav development needs vertical slice planning, task briefs, task context, task ledger updates, TDD evidence, spec review, quality review, validation logs, or handoff to six-domain verification.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Vertical Slices

## Purpose

Plan, dispatch, review, and close production implementation through file-backed vertical slices.

## Workflow

1. Run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json` before planning.
2. Read `references/development-task-packets.md` before creating task packets.
3. Read `references/development-review.md` before closing tasks or preparing handoff.
4. If task artifacts are missing, run `node "$SPECNAV_DEVELOPMENT_ROOT/skills/specnav-vertical-slices/scripts/create-vertical-slice.js" --task-id=<task-id> --json`.
5. Organize `tasks.md` as user-visible milestone sections with a substantive
   `User outcome:` (or `用户结果：`) followed by the complete engineering
   checkbox checklist. Individual engineering tasks do not need to be rewritten
   as user stories. Avoid vague layer-only tasks.
6. After creating or editing `tasks.md`, run `node "$SPECNAV_CORE_ROOT/scripts/tasks-md.js" normalize --json`. Plain bullets must be converted to standard OpenSpec checkbox syntax instead of left for archive-time interpretation.
7. Compare the edited task list with the committed Git baseline. Never delete,
   merge, or renumber baseline tasks to satisfy a contract. Explicit removals
   require `development/task-change-approval.json` with `approved_by: "user"`,
   an approval timestamp, a reason, and the removed task IDs.
8. Create each task packet with `brief.md` and `context.json`. Task packet IDs
   must use canonical `NNN-kebab-case`, for example
   `001-dashboard-summary`.
9. Ensure `openspec/changes/<change>/codegraph/claims-map.json` and `evidence-query-plan.json` contain development claims for the task. The `create-vertical-slice.js` scaffold writes these automatically; re-run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-plan.js" --stage development --write --json` after manual task restructuring.
10. Maintain task ledger, drift checks, validation logs, extraction map, reports, spec review, and quality review. Replace every scaffold marker with direct evidence before closing a task.
11. If any task, report, requirement, or handoff mentions SQL, DDL, DML, seed data, menus, permissions, or migrations, write executable SQL under `development/migrations/`, set `development/migrations/manifest.json` to `required=true`, and document execution, validation, and rollback in `development/migrations/README.md`.
12. No fallback around failed task review is allowed.
13. Before verification handoff, run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json`.

## Required Outputs

- `tasks.md`.
- `development/tasks/<task-id>/brief.md` and `context.json`.
- Task reports, review files, ledgers, validation logs, and `development/handoff-to-verify.md`.
- `development/migrations/manifest.json`, `development/migrations/README.md`, and any required executable `.sql` migration files.
- `codegraph/claims-map.json` and `codegraph/evidence-query-plan.json` with development task claims.
- Task and review shells: `assets/tasks.md`, `assets/task/brief.md`, `assets/task/context.json`, `assets/task/report.md`, `assets/task/spec-review.md`, `assets/task/quality-review.md`, `assets/development/task-ledger.jsonl`, `assets/development/drift-check.jsonl`, `assets/development/validation-log.jsonl`, `assets/development/handoff-to-verify.md`, `assets/development/migrations/manifest.json`, and `assets/development/migrations/README.md`.

## Stop Conditions

- Entry blockers remain.
- The standard lane lacks a committed Git baseline for `tasks.md`.
- Scope is insufficient.
- `tasks.md` has plain bullets, mixed checkbox/plain bullets, or any unchecked item during handoff.
- A baseline task is removed, merged, or renumbered without explicit user
  approval.
- A task packet ID does not use `NNN-kebab-case`.
- Any task report, review file, ledger, drift check, validation log, or handoff file still contains `<decision-required>`, "Replace this scaffold", `development-entry-scaffold`, `vertical-slice-scaffold`, or `pending-vertical-slices`.
- A task lacks allowed files.
- A task duplicates component logic that should be extracted under the component architecture spec.
- SQL, DDL, DML, seed data, menu, permission, or migration work is mentioned but `development/migrations/manifest.json` is missing, still `required=false`, or lacks executable SQL and rollback/validation evidence.
- Drift blocks development.
- Local validation or required review fails.

## Validation

- Run entry validation during planning and handoff validation before verification.
