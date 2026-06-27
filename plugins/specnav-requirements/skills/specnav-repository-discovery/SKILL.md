---
name: specnav-repository-discovery
description: Use this skill when SpecNav needs read-only repository evidence before foundation specs or requirements negotiation, especially when foundation specs are missing or stale.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Repository Discovery

## Purpose

Collect read-only repository evidence that helps a human or agent negotiate the four foundation specs. Discovery is advisory: it can identify likely framework, routing, API, component, test, and workflow signals, but it must not replace the foundation spec gate.

## Workflow

1. Read `references/repository-discovery.md`.
2. Run `node "$SPECNAV_REQUIREMENTS_ROOT/scripts/repository-discovery.js" --json` to inspect evidence without writing.
3. If the evidence should be reused, run `node "$SPECNAV_REQUIREMENTS_ROOT/scripts/repository-discovery.js" --write --json` to write `openspec/.specnav/context/repository-discovery.json`.
4. Run `node "$SPECNAV_REQUIREMENTS_ROOT/scripts/repository-discovery-contract.js" --json`.
5. Read `references/spec-negotiation.md` before turning findings, conflicts, or open items into foundation questions.
6. Read `references/discovery-schema.md` before manually repairing discovery JSON.
7. Use `assets/discovery/repository-discovery.json`,
   `assets/discovery/foundation-update-map.json`, and
   `assets/discovery/spec-negotiation.md` only as examples or starting points;
   prefer current repository evidence.

## Required Outputs

- Optional advisory artifact: `openspec/.specnav/context/repository-discovery.json`.
- Each finding must include `evidence_refs` and `confidence`.
- Conflicts must include a `question` or `open_item`.

## Stop Conditions

- The repository root is unclear.
- Discovery contract reports path escapes, missing evidence refs, invalid confidence, or unknown foundation specs.
- A finding would require changing foundation specs without user confirmation.

## Validation

- Discovery is valid only when `repository-discovery-contract.js --json` returns `ok: true`.
- Requirements are valid only when `requirements-contract.js --json` returns `ok: true`; repository discovery does not satisfy that gate.
