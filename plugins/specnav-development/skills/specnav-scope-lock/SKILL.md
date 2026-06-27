---
name: specnav-scope-lock
description: Use this skill when SpecNav development needs a scope.json, allowed roots, denied roots, operation permissions, prototype source binding, or enforcement of production edit boundaries before implementation.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Scope Lock

## Purpose

Create and enforce the development scope lock for the active change.

## Workflow

1. Run `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json`.
2. Use the active change from the contract only; no fallback to newest change is allowed.
3. Read `references/scope-lock.md` before creating or expanding scope.
4. If `scope.json` is missing, run `node "$SPECNAV_DEVELOPMENT_ROOT/skills/specnav-scope-lock/scripts/create-scope-lock.js" --json`.
5. Create or repair `scope.json` with clean relative allowed roots, denied roots, review roots, operation booleans, prototype sources, and `expires_when`.
6. Bind prototype sources to the approved prototype entry only.
7. If requested work exceeds scope, report `NEEDS_CONTEXT` or `BLOCKED` instead of expanding silently.

## Required Outputs

- `openspec/changes/<active-change>/scope.json`.
- Scope shell: `assets/scope.json`.

## Stop Conditions

- Entry blockers remain.
- Paths are absolute, unsafe, or stale.
- The requested edit is outside allowed scope.

## Validation

- Rerun `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json` and proceed only when scope blockers are gone.
