---
name: specnav-branch-finish
description: Use this skill when SpecNav needs to finish a git branch, review worktree state, record cleanup provenance, merge readiness, or decide whether a SpecNav-owned worktree can be removed.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Branch Finish

## Purpose

Record branch and worktree facts before finish or cleanup.

## Workflow

1. Collect git dir, common dir, current branch, base branch, worktree path, finish action, cleanup decision, and provenance.
2. Read `references/branch-finish.md` before writing cleanup decisions.
3. Preserve unknown or externally managed worktrees.
4. Use `assets/branch-finish.md` as the shell when the artifact is missing.
5. If the user asks to archive before branch finish, run `node "$SPECNAV_OPERATIONS_ROOT/scripts/archive-change.js" --change <change> --json` first and require `operations/archive-receipt.json` under `openspec/changes/archive/<date>-<change>/`.
6. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing branch-finish artifacts for still-active changes.

## Required Outputs

- `operations/branch-finish.md`.
- Branch finish shell: `assets/branch-finish.md`.

## Stop Conditions

- Worktree ownership is unknown.
- Untracked files are unreviewed.
- Cleanup lacks SpecNav-owned provenance.
- Archive receipt is missing after a requested archive.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
