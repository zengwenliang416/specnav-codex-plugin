---
name: specnav-codegraph-impact
description: Use this skill when SpecNav needs CodeGraph blast-radius or affected-surface evidence before verification, release, archive, or risky production edits.
---

# SpecNav CodeGraph Impact

## Purpose

Produce impact evidence for release, operations, archive, or high-risk
development decisions. Impact evidence is written through the same evidence
contract as context evidence.

## Workflow

1. Resolve the installed `specnav-codegraph` plugin root with the SpecNav runtime
   resolver.
2. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-doctor.js" --json`.
3. Form one blast-radius question such as which routes, callers, services,
   components, or tests are affected by the changed symbols.
4. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-impact.js" --query
   "impact question" --write --json`.
5. Include the generated evidence index path in verification or operations
   handoff.

## Stop Conditions

- The project is not indexed and the stage requires CodeGraph.
- The impact question is missing.
- CodeGraph evidence is stale after final production edits.
- The script reports wrong-root, missing CLI, or claim-unverified blockers.

## Validation

- Release and archive may claim CodeGraph impact review only when the evidence
  artifact is fresh.
- Stale impact evidence must block production operations in required policy
  mode.
- HTML reports should summarize evidence and link artifacts, not embed long
  source dumps.
