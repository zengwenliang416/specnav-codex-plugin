# Task Brief: 026-report-accessibility-security

## Goal

Stakeholder can use desktop, mobile, keyboard, print, and escaped secret-safe report pages.

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

Stakeholder can use desktop, mobile, keyboard, print, and escaped secret-safe report pages. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Verify responsive layout, keyboard operation, semantic tables, status text, print output, HTML escaping, and secret redaction.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/reporting/**
- plugins/specnav-verification/assets/report/**
- tests/verification-v2/reports/**
- tests/verification-v2/security/**
- tests/run-verification-v2-report-browser.sh

## Interfaces / Seams

- Security and accessibility checks validate rendered output without changing report facts.

## Components To Create

- Report accessibility fixture suite
- Report security fixture suite

## Components To Reuse

- Three report renderers
- Secret redactor

## Components To Extract

- Shared HTML escaper and accessibility test helpers

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-report-center/spec.md`.
- Acceptance assertions: `AC-12`, `AC-30`.
- Report model renders through escaping and shared components, then browser tests inspect desktop, mobile, keyboard, and print behavior.

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

- `bash tests/run-verification-v2-report-browser.sh`
- `node --test tests/verification-v2/security/report-security.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `014-evidence-redaction`, `024-overview-report`, `025-case-report-pages`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/026-report-accessibility-security`.
