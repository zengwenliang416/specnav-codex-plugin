# Task Brief: 018-failure-classification

## Goal

Maintainer can classify failures into product, test, environment, flaky, blocker, or requirement categories.

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

Maintainer can classify failures into product, test, environment, flaky, blocker, or requirement categories. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Freeze failure evidence and classify product defect, test defect, environment defect, flaky, expected blocker, or requirement ambiguity.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/repair/**
- tests/verification-v2/repair-loop/**

## Interfaces / Seams

- Classification never edits code; it chooses the next legal lifecycle action.

## Components To Create

- Failure packet
- Failure classifier

## Components To Reuse

- Reading model
- EvidenceStore

## Components To Extract

- Root-cause check registry and classification reason format

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-repair-loop/spec.md`.
- Acceptance assertions: `AC-06`, `AC-25`, `AC-27`.
- Failed reading produces a frozen packet, classification, owner, and next action.

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

- `node --test tests/verification-v2/repair-loop/classifier.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `015-reading-model`, `016-six-domain-aggregation`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/018-failure-classification`.
