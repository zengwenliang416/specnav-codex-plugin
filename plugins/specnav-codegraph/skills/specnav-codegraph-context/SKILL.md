---
name: specnav-codegraph-context
description: Use this skill when SpecNav needs durable CodeGraph evidence for a requirement, prototype decision, development task, or verification question about actual code structure.
---

# SpecNav CodeGraph Context

## Purpose

Create durable code evidence for one explicit question. The result is written to
`openspec/changes/<change>/codegraph/evidence.jsonl` only when `--write` is
used and an active change is known.

## Workflow

1. Resolve the installed `specnav-codegraph` plugin root with the SpecNav runtime
   resolver.
2. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-doctor.js" --json` and
   confirm the project is indexed.
3. Ask or derive one precise code-structure question.
4. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-context.js" --query
   "question" --stage development --write --json`.
5. Use `--claim` and `--task` when mapping the result to a requirement or
   vertical slice.
6. Report the written raw evidence and evidence index paths.

## Stop Conditions

- The query is missing or vague.
- CodeGraph CLI is missing.
- The project is not indexed.
- CodeGraph resolves a different project root.
- The script returns `codegraph:claim-unverified`.

## Validation

- Evidence is valid only when `confidence` is `matched` or an explicit partial
  result is accepted by the owning stage policy.
- Evidence must include the query and source file paths.
- Do not use broad grep/read exploration as a substitute for missing CodeGraph
  evidence in a required stage.
