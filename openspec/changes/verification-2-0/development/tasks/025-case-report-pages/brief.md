# Task Brief: 025-case-report-pages

## Goal

Stakeholder can review approved case contracts in test-case-catalog.html and immutable attempt evidence in test-case-results.html.

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

Stakeholder can review approved case contracts in test-case-catalog.html and immutable attempt evidence in test-case-results.html. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Render catalog and results pages with shared components, case filters, attempt history, evidence, and repair links.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/reporting/**
- plugins/specnav-verification/assets/report/**
- tests/verification-v2/reports/**

## Interfaces / Seams

- Both pages share navigation and components while retaining distinct case-contract and execution-result responsibilities.

## Components To Create

- Test-case catalog renderer
- Test-case results renderer

## Components To Reuse

- Shared report shell and report components
- Report model

## Components To Extract

- Shared case row, attempt timeline, reading comparison, and evidence viewer

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-report-center/spec.md`.
- Acceptance assertions: `AC-09`, `AC-10`, `AC-11`, `AC-29`, `AC-38`.
- One report model projects approved contract facts and immutable result history into linked pages.

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

- `node --test tests/verification-v2/reports/case-pages.test.js`
- `bash tests/run-verification-v2-report-pages.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `023-report-model`, `024-overview-report`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/025-case-report-pages`.
