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

## Workflow

1. Run the shared triage:

```bash
node "$SPECNAV_CORE_ROOT/scripts/change-triage.js" --intent "$INTENT" --json
```

2. If `lane` is not `light`, stop and route to the reported standard or full lane. Do not force light mode.
3. Require an existing OpenSpec project and a clean active change. Do not call an OpenSpec native skill.
4. Create the light artifacts:

```bash
node "$SPECNAV_DEVELOPMENT_ROOT/skills/specnav-light-change/scripts/create-light-change.js" --intent "$INTENT" --paths "$PATHS" --json
```

5. Run the entry gate:

```bash
node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json
```

6. Only edit files listed by the generated `scope.json`.
7. Before verification handoff, update `tasks.md` to `[x]` and update each
   `acceptance.json` assertion to `passing` with an `evidence_ref`, then run:

```bash
node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json
```

## Required Light Artifacts

- `openspec/changes/<change>/risk-tier.json`
- `openspec/changes/<change>/requirements.md`
- `openspec/changes/<change>/acceptance.md`
- `openspec/changes/<change>/acceptance.json`
- `openspec/changes/<change>/spec-map.json`
- `openspec/changes/<change>/component-impact-map.json`
- `openspec/changes/<change>/prototype/decision.json`
- `openspec/changes/<change>/scope.json`
- `openspec/changes/<change>/tasks.md`

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
