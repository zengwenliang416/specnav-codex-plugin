# Spec Negotiation

Discovery findings are candidates for foundation spec updates, not final
decisions.

## How To Use Findings

- Treat high-confidence findings as evidence-backed prompts.
- Treat conflicts as questions that must be answered before foundation specs are
  updated.
- Treat open items as negotiation backlog, not blockers by themselves.
- Prefer direct user confirmation when code evidence can be interpreted in more
  than one way.

## Foundation Targets

Discovery findings may target only:

- `ui-design`
- `system-architecture`
- `frontend-backend-data-flow`
- `component-architecture`

Use `assets/discovery/foundation-update-map.json` as a mapping example when
turning evidence into foundation spec edits.

## Gate Rule

Discovery never replaces `foundation-specs.js`. After any foundation update,
rerun `foundation-specs.js --json`; before requirements handoff, rerun
`requirements-contract.js --json`.
