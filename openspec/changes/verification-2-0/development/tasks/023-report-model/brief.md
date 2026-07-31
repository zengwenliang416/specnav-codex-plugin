# Task Brief: 023-report-model

## Goal

Stakeholder can receive one validated report model for all three report pages and every verdict state.

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
- openspec/changes/verification-2-0/specs/verification-report-center/spec.md

## Vertical Slice

Stakeholder can receive one validated report model for all three report pages and every verdict state. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Build one deterministic report model from cases, runs, readings, evidence, failures, freshness, and gate decisions.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/reporting/**
- tests/verification-v2/reports/**

## Interfaces / Seams

- Renderers consume only the validated report model and never query raw runner output directly.

## Components To Create

- Report model builder
- Report model schema

## Components To Reuse

- Six-domain aggregate
- Evidence index
- Repair state

## Components To Extract

- Shared report selectors and evidence-link resolver

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-report-center/spec.md`.
- Acceptance assertions: `AC-08`, `AC-09`, `AC-10`, `AC-11`, `AC-29`.
- Validated source artifacts become one report model used by every page and state.

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

- `node --test tests/verification-v2/reports/report-model.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `016-six-domain-aggregation`, `018-failure-classification`, `021-case-freshness`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/023-report-model`.
