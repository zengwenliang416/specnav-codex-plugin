---
version: 1
name: AI Annotation Policy (L3)
description: L3 AI-facing anchor-comment policy for code touched by SpecNav changes.
enforcement: advisory
anchor_pattern: "@ai-anchor"
seam_globs:
  - "src/**"
---

# AI Annotation Policy (L3)

## Overview

This is the **L3** layer of SpecNav knowledge governance. L1 is
`system-architecture` (immutable boundaries), L2 is the module/component design
specs (tradeoffs and dependencies), and L3 is the anchor comment that lives
directly in the code an AI agent reads. L3 exists because natural-language specs
alone leave an agent guessing about a specific code seam; an anchor comment on
that seam raises retrieval accuracy and lowers the number of task rounds.

This spec is **optional and advisory by default**. SpecNav never blocks a change
for missing anchors unless this policy declares `enforcement: gate`. Absent
policy file means no anchor scanning is expected at all.

## Anchor Convention

An anchor comment marks a key seam an AI agent will need to reason about. Use the
`anchor_pattern` token (default `@ai-anchor`) inside a normal code comment:

```
// @ai-anchor FLOW-checkout-submit: validates cart totals before payment intent.
```

- Place one anchor at the entry of each key seam (route handler, service method,
  state reducer, cross-module boundary).
- Keep the intent one line; describe *why this seam exists*, not *what the line does*.
- Reference a stable id (e.g. a `FLOW-...` id from `frontend-backend-data-flow`)
  when the seam maps to a documented flow.

## Seam Coverage

`seam_globs` declares which files are in scope for anchor coverage. Only files
matching these globs that are also touched by the active change are scanned. Test
files, generated code, and `openspec/` are never scanned.

- List the source roots that carry business seams (default `src/**`).
- Narrow the globs to reduce noise; widen them as anchor discipline matures.

## Enforcement

- `enforcement: advisory` (default) — the anchor scan reports coverage and emits
  an `anchor.coverage` event, but never blocks. Use this to measure adoption
  before committing to a gate (aligns with the repo's "measure before you gate"
  rule).
- `enforcement: gate` — a touched in-scope file with no anchor emits
  `anchor-uncovered:<file>` and blocks verification. Individual files can still be
  excepted through the standard SpecNav override mechanism.

Flip to `gate` only after the advisory coverage trend (see
`gate-effectiveness.js`) shows the policy is well understood.
