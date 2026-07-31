# Task Brief: 001-baseline-fake-green

## Goal

Maintainer can reproduce every current fake-green acceptance path with failing V2 fixtures.

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
- openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md

## Vertical Slice

Maintainer can reproduce every current fake-green acceptance path with failing V2 fixtures. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Freeze current validator behavior and create executable counterexamples for missing, empty, stale, tampered, and manual-green evidence.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-development/scripts/development-contract.js
- plugins/specnav-verification/scripts/evidence-runner.js
- tests/run-verification-plugin-fixtures.sh
- tests/run-verification-v2-baseline.sh
- tests/verification-v2/baseline/**
- docs/verification-v2-gap-analysis.md
- openspec/changes/verification-2-0/development/**
- openspec/changes/verification-2-0/tasks.md

## Interfaces / Seams

- Fixtures call the current public verification scripts and record the incorrect accepted state before V2 fixes.

## Components To Create

- Fake-green fixture corpus
- Verification V2 gap analysis

## Components To Reuse

- Existing verification fixture helpers
- Current verify-domains validator

## Components To Extract

- Reusable negative-fixture builder when two counterexamples share setup

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Acceptance assertions: `AC-17`, `AC-18`, `AC-21`, `AC-29`.
- Baseline evidence feeds later contract and integrity tasks; it never changes production behavior.

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

- `node --test tests/verification-v2/baseline/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-verification-v2-baseline.sh`
- `npm test`

## Stop Conditions

- Stop if a dependency task is incomplete: no implementation dependency beyond approved upstream contracts.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/001-baseline-fake-green`.
