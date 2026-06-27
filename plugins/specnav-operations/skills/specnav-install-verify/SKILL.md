---
name: specnav-install-verify
description: Use this skill when SpecNav must verify plugin installation, host exposure, marketplace discovery, workspace support, reload requirement, config status, or installed plugin root evidence.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Install Verify

## Purpose

Verify installed plugin surfaces from current host evidence.

## Workflow

1. Resolve marketplace root and plugin root from metadata.
2. Read `references/install-verification.md` before writing install evidence.
3. Run doctor or structural install checks from the plugin root.
4. Do not run install checks from the target project directory.
5. Use `assets/install-verification.json` as the shell when the artifact is missing.
6. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing.

## Required Outputs

- `operations/install-verification.json`.
- Install shell: `assets/install-verification.json`.

## Stop Conditions

- Plugin source is unknown.
- Discovery root is unknown.
- Host evidence is missing.
- Reload requirement is unknown.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
