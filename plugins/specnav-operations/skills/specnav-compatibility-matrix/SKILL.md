---
name: specnav-compatibility-matrix
description: Use this skill when SpecNav must document host compatibility, support level, supported Codex surfaces, doctor result, verification command, known limitations, or reload requirements.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Compatibility Matrix

## Purpose

Record support evidence for host and plugin surfaces.

## Workflow

1. Review install verification, doctor output, host limitations, and reload behavior.
2. Read `references/compatibility-matrix.md` before writing support claims.
3. Do not claim support without fresh smoke evidence.
4. Use `assets/compatibility-matrix.md` as the shell when the artifact is missing.
5. Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` after writing.

## Required Outputs

- `operations/compatibility-matrix.md`.
- Compatibility shell: `assets/compatibility-matrix.md`.

## Stop Conditions

- Doctor evidence is missing.
- Verification command evidence is missing.
- Known limitations are not documented.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
