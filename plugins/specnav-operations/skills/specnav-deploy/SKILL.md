---
name: specnav-deploy
description: Use this skill when SpecNav release target is project-deploy and deployment mechanics, environment, commands, config, secrets, migrations, smoke checks, owner, or deploy window must be documented.
disable-model-invocation: true
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Deploy

## Purpose

Prepare deployment mechanics for project-deploy targets.

## Workflow

1. Use only when release target is `project-deploy`.
2. Read `references/deploy-plan.md` before writing deployment mechanics.
3. Document exact deployment mechanics before deployment.
4. If `development/migrations/manifest.json` has `required=true`, copy/write `operations/migration-deployment.json` from `assets/migration-deployment.json`, apply every migration id from the manifest, record evidence refs, and ensure `deploy-plan.md` references `development/migrations/manifest.json`.
5. Use `assets/deploy-plan.md` as the shell when the artifact is missing.
6. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing.

## Required Outputs

- `operations/deploy-plan.md`.
- `operations/migration-deployment.json` when development migrations are required.
- Deploy shells: `assets/deploy-plan.md` and `assets/migration-deployment.json`.

## Stop Conditions

- Release target is not project-deploy.
- Secrets or config are unknown.
- Migration effects are unclear.
- Required migrations are not represented in `operations/migration-deployment.json`.
- Smoke checks cannot be named.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
