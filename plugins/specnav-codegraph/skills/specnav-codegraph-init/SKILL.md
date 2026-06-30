---
name: specnav-codegraph-init
description: Use this skill when the user explicitly asks to initialize CodeGraph for the current repository so SpecNav can create code evidence from a project-local index.
---

# SpecNav CodeGraph Init

## Purpose

Initialize a project-local `.codegraph/` index through an explicit user action.
This is per repository and is separate from installing the SpecNav plugin.

## Workflow

1. Resolve the installed `specnav-codegraph` plugin root with the SpecNav runtime
   resolver.
2. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-doctor.js" --json` to
   confirm whether an index already exists.
3. If the project is not indexed and the user confirmed initialization, run
   `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-init.js" --yes --json`.
4. Re-run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-doctor.js" --json`.
5. Report the index path, policy profile, warnings, and blockers.

## Stop Conditions

- The CodeGraph CLI is missing.
- The user did not explicitly confirm project indexing.
- The script reports `codegraph:init-confirmation-required`.
- The project root is unclear.

## Validation

- Initialization is valid only when the second status check shows
  `index.initialized: true`.
- Do not create or modify OpenSpec change artifacts from this skill.
- Do not claim evidence exists until `specnav-codegraph-context`,
  `specnav-codegraph-claims`, or `specnav-codegraph-impact` writes it.
