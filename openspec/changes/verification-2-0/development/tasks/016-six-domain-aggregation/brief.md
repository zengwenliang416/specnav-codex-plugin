# Task Brief: 016-six-domain-aggregation

## Goal

Release owner can receive six-domain and release verdicts derived only from validated case readings.

## Parent Artifacts

- openspec/specs/ui-design/design.md
- openspec/specs/system-architecture/design.md
- openspec/specs/frontend-backend-data-flow/design.md
- openspec/specs/component-architecture/design.md
- openspec/changes/verification-2-0/requirements.md
- openspec/changes/verification-2-0/acceptance.md
- openspec/changes/verification-2-0/spec-map.json
- openspec/changes/verification-2-0/component-impact-map.json
- openspec/changes/verification-2-0/prototype/handoff.md
- openspec/changes/verification-2-0/prototype/decision.json
- openspec/changes/verification-2-0/prototype/artifact/index.html
- openspec/changes/verification-2-0/specs/six-domain-evaluation/spec.md

## Vertical Slice

Release owner can receive six-domain and release verdicts derived only from validated case readings. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Aggregate reading-to-case, case-to-domain, and domain-to-release states with no manual green override or light lane.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/evaluation/**
- plugins/specnav-verification/kernel/gates/**
- plugins/specnav-verification/scripts/verify-domains.js
- tests/verification-v2/evaluation/**

## Interfaces / Seams

- Domain skills collect or explain evidence but cannot override the kernel aggregate.

## Components To Create

- Six-domain aggregator
- Verification DecisionEngine

## Components To Reuse

- Existing domain rubrics
- Reading model

## Components To Extract

- Shared terminal-state lattice and blocker precedence

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/six-domain-evaluation/spec.md`.
- Acceptance assertions: `AC-03`, `AC-18`, `AC-19`, `AC-21`, `AC-28`.
- Validated readings become case verdicts, six domain verdicts, and one auditable release decision.

## State / Error / Empty / Loading Behavior

- Loading: expose bounded progress or a running attempt without claiming completion.
- Empty: report the missing case, evidence, runtime, or source artifact explicitly.
- Error: preserve logs and return the exact blocker id and affected artifact.
- Disabled: do not offer a verification bypass or simplified lane.
- Permission: require explicit approval for case signoff, runtime installation, not-applicable decisions, and release actions.

## TDD Requirement

- Add a failing focused test or fixture before production behavior.
- Preserve the failing evidence when the task repairs a false-positive or lifecycle defect.

## Verification Commands

- `node --test tests/verification-v2/evaluation/aggregation.test.js`
- `bash tests/run-verification-v2-no-light.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `005-case-planning-approval`, `013-evidence-integrity`, `015-reading-model`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/016-six-domain-aggregation`.
