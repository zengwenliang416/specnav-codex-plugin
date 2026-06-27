# Prototype Approval

Read this before writing `prototype/handoff.md` or `prototype/decision.json`.

## Approval Rule

Approval must be explicit from the user. Do not infer approval from a green
verifier report or from silence.

## Handoff Topics

The handoff must name:

- approved branch and variant;
- screens or flows;
- components to create;
- components to reuse;
- extraction targets;
- API contracts;
- data flows;
- state behavior;
- out-of-scope items;
- required tests;
- open risks.

## Promotion Rule

A prototype never promotes directly to production. It promotes only to the
development entry gate with `promotion: requires_development_gate`.
