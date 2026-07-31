# Task Brief: 011-midscene-runner

## Goal

Reviewer can use Midscene for UI interaction while deterministic or human-approved oracles retain final verdict ownership.

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

Reviewer can use Midscene for UI interaction while deterministic or human-approved oracles retain final verdict ownership. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Capture Midscene interaction, model metadata, prompts, descriptions, screenshots, and deterministic-oracle linkage without storing secrets.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/execution/**
- plugins/specnav-verification/kernel/adapters/midscene-adapter.js
- tests/verification-v2/midscene/**

## Interfaces / Seams

- Midscene may drive or describe the UI; Playwright assertions, structured facts, or approved human signoff own PASS.

## Components To Create

- Midscene adapter
- Oracle boundary validator

## Components To Reuse

- Playwright adapter
- Runtime provider probe

## Components To Extract

- Model metadata normalization and secret-safe prompt capture

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Acceptance assertions: `AC-05`, `AC-16`, `AC-30`.
- Midscene performs interaction, emits evidence, and waits for a separate oracle reading before terminal evaluation.

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

- `node --test tests/verification-v2/midscene/*.test.js`
- `bash tests/run-verification-v2-midscene-contract.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `007-runtime-installer`, `008-runtime-doctor`, `010-playwright-runner`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/011-midscene-runner`.
