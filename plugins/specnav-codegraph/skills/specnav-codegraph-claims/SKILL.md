---
name: specnav-codegraph-claims
description: Use this skill when SpecNav must check whether requirements, routes, services, components, APIs, or cross-layer flow claims are backed by CodeGraph evidence.
---

# SpecNav CodeGraph Claims

## Purpose

Validate the connection between SpecNav claims and CodeGraph evidence. This
skill checks the claims map and evidence index; it does not invent missing
claims or mark unmatched claims as verified.

## Workflow

1. Resolve the installed `specnav-codegraph` plugin root with the SpecNav runtime
   resolver.
2. Ensure `openspec/changes/<change>/codegraph/evidence.jsonl` exists for the
   active change.
3. Ensure `openspec/changes/<change>/codegraph/claims-map.json` names the claims
   that require code evidence.
4. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-claims.js" --json`.
5. For every `codegraph:claim-unverified:<id>` blocker, either gather evidence
   with `specnav-codegraph-context` or revise the claim.

## Stop Conditions

- There is no active change.
- `claims-map.json` is missing or invalid.
- Any required claim has no matching evidence.
- Evidence is stale, missing, or disabled by project policy.

## Validation

- A claim is verified only when `claims-map.json` points to evidence present in
  `evidence-index.json`.
- Disabled CodeGraph policy must be reported as not CodeGraph verified.
- Verification reports must carry unresolved claim blockers forward.
