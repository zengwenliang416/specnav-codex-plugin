# Task Brief: 019-development-repair-bridge

## Goal

Developer can receive a scoped repair task linked to frozen verification failure evidence.

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
- openspec/changes/verification-2-0/specs/verification-repair-loop/spec.md

## Vertical Slice

Developer can receive a scoped repair task linked to frozen verification failure evidence. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Route product/test defects into standard development task packets with scope, failure references, reviews, and no evidence mutation.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/repair/**
- plugins/specnav-development/**
- plugins/specnav-core/**
- tests/verification-v2/repair-loop/**

## Interfaces / Seams

- Verification owns failure facts and closure; Development owns code repair and review; Core owns stage transition.

## Components To Create

- Verification-to-development repair bridge
- Repair link contract

## Components To Reuse

- SpecNav vertical-slice task packet
- Scope lock
- Break-loop governance

## Components To Extract

- Failure-to-task context mapper

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-repair-loop/spec.md`.
- Acceptance assertions: `AC-25`, `AC-27`.
- Failure packet creates a bounded repair task and receives a reviewed repair reference back.

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

- `bash tests/run-verification-v2-repair-bridge.sh`
- `node --test tests/verification-v2/repair-loop/development-bridge.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `018-failure-classification`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/019-development-repair-bridge`.
