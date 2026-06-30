---
name: specnav-codegraph-status
description: Use this skill when the user asks whether CodeGraph is installed, indexed, visible through MCP, stale, policy-disabled, or able to provide SpecNav code evidence for the current project.
---

# SpecNav CodeGraph Status

## Purpose

Report the CodeGraph evidence-layer state without changing global agent config,
project indexes, OpenSpec artifacts, or SpecNav lifecycle files.

## Workflow

1. Resolve the installed `specnav-codegraph` plugin root with the SpecNav runtime
   resolver before running Bash.
2. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-doctor.js" --json`.
3. Report CLI availability, supported version, MCP config visibility, project
   index state, active policy profile, effective mode, warnings, and blockers.
4. If the stage is relevant, re-run with `--stage requirements`,
   `--stage prototype`, `--stage development`, `--stage verification`, or
   `--stage operations`.
5. Treat prior chat claims as unverified unless the current status JSON confirms
   them.

## Stop Conditions

- The plugin root cannot be resolved.
- `codegraph-doctor.js` exits non-zero and reports blocking status.
- The user asks to initialize or configure CodeGraph; switch to
  `specnav-codegraph-init` or `specnav-codegraph-setup` instead of doing it
  here.

## Validation

- `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-doctor.js" --json` must
  return parseable JSON.
- Status is advisory only unless `decision.result` is `block`.
- Do not claim CodeGraph verified code unless an evidence artifact exists.
