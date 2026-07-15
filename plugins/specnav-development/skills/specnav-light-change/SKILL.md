---
name: specnav-light-change
description: Use this skill when SpecNav routes a simple docs, copy, label, comment, or low-risk styling/config request to the Codex light lane so the change can proceed without the full requirements/prototype/development packet.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Light Change

## Purpose

Create and validate the minimum legal SpecNav artifacts for a simple change.
Light lane is for low-risk changes such as docs, copy, labels, comments,
README edits, and very small styling/config adjustments.

## Workflow (v2, default)

1. Run the shared triage:

```bash
node "$SPECNAV_CORE_ROOT/scripts/change-triage.js" --intent "$INTENT" --json
```

2. If `lane` is not `light`, stop and route to the reported standard or full lane. Do not force light mode.
3. Require an existing OpenSpec project and a clean active change. Do not call an OpenSpec native skill.
4. Create the single-file light change:

```bash
node "$SPECNAV_DEVELOPMENT_ROOT/skills/specnav-light-change/scripts/create-light-change.js" --intent "$INTENT" --paths "$PATHS" --json
```

This writes ONE file — `openspec/changes/<change>/light-change.json` — that
carries the lane, editable paths, acceptance assertions, tasks, and a pending
user test in one place. Paths starting with `../` (sibling repositories) are
accepted and recorded as `external_repos` declarations so the guard allows
those edits.

5. Run the entry gate:

```bash
node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json
```

6. Only edit files listed in `light-change.json` `entry.editable_paths` (and
   declared `external_repos`). Codex hooks record scope drift as
   warnings by default and block under `SPECNAV_STRICT=1`.
7. Before verification handoff, inside `light-change.json`: set each task
   `done: true`, set each acceptance assertion to `passing` with an
   `evidence_ref`, then run:

```bash
node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json
```

8. Do not fabricate user testing. Before `$specnav-verify` can go green, ask
   the user to confirm the change works, then record their words in
   `light-change.json` `user_test` (`status: "approved"`, `user_decision`).

## Required Light Artifacts

- `openspec/changes/<change>/light-change.json` — the only file.

Legacy packet mode (`--format packet`) still writes the v1 14-artifact set
(`light-gate.json`, `scope.json`, `tasks.md`, `acceptance.*`, `verify/*` …)
for projects that depend on it; in-flight v1 changes keep validating.

## Escalation

Escalate to standard or full lane if the request touches authentication,
permissions, billing, security, database, API routes, deployment, package
manifests, SpecNav internals, more than three intended paths, or more than ten
production files after edits.

## Stop Conditions

- `missing-openspec`
- `active-change`
- `light-change:paths-required`
- triage reports `standard` or `full`
- the development entry or handoff gate is blocked

## Validation

- `node "$SPECNAV_CORE_ROOT/scripts/change-triage.js" --intent "$INTENT" --json`
- `node "$SPECNAV_DEVELOPMENT_ROOT/skills/specnav-light-change/scripts/create-light-change.js" --intent "$INTENT" --paths "$PATHS" --json`
- `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json`
- `node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json` before verification handoff
