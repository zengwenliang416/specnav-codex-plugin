# Development Basis: verification-2-0

## Requirements Reference

- openspec/specs/ui-design/design.md
- openspec/specs/system-architecture/design.md
- openspec/specs/frontend-backend-data-flow/design.md
- openspec/specs/component-architecture/design.md
- openspec/changes/verification-2-0/requirements.md
- openspec/changes/verification-2-0/acceptance.md
- openspec/changes/verification-2-0/spec-map.json
- openspec/changes/verification-2-0/component-impact-map.json

## Prototype Reference

- openspec/changes/verification-2-0/prototype/handoff.md
- openspec/changes/verification-2-0/prototype/decision.json
- openspec/changes/verification-2-0/prototype/artifact/index.html

## OpenSpec Design Reference

- `openspec/changes/verification-2-0/proposal.md`
- `openspec/changes/verification-2-0/design.md`
- `openspec/changes/verification-2-0/specs/verification-contract-v2/spec.md`
- `openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md`
- `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`
- `openspec/changes/verification-2-0/specs/six-domain-evaluation/spec.md`
- `openspec/changes/verification-2-0/specs/verification-repair-loop/spec.md`
- `openspec/changes/verification-2-0/specs/verification-report-center/spec.md`
- `openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md`

## Handoff Reference

The verified `ui-html` prototype variant
`three-page-verification-report-workspace` is approved only for development
planning. Production code must still pass scope, task, TDD, spec review, quality
review, six-domain verification, release, and archive gates.

## Component Architecture Constraint

One host-neutral Verification Kernel owns schemas, state machines, evidence
integrity, aggregation, freshness, report models, and gate semantics. Codex,
Claude Code, and CodeFree-O remain thin adapters. Shared report components and
runner lifecycle utilities must be extracted before a second implementation
appears.

## Execution Order

Tasks follow `development/task-graph.json`. A task may start only when every
dependency is complete and its packet still matches requirements, prototype,
scope, and current CodeGraph evidence policy.

The complete wave schedule, runtime installation point, cross-repository
handoff rules, task completion contract, and final exit gates are defined in
`development/execution-plan.md`. The capability grouping in `tasks.md` is not
the execution order; the task graph and execution plan are authoritative.
