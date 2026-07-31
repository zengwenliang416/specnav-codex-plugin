# Task Brief: 009-command-runner

## Goal

Reviewer can execute command-backed cases and inspect structured attempts, logs, and exit evidence.

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

Reviewer can execute command-backed cases and inspect structured attempts, logs, and exit evidence. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Implement orchestrator lifecycle and command adapter with timeout, cancellation, stdout/stderr, exit status, and attempt metadata.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/kernel/execution/**
- plugins/specnav-verification/kernel/adapters/command-adapter.js
- plugins/specnav-verification/schemas/test-case.schema.json
- tests/verification-v2/contracts/fixtures/positive/test-case.json
- tests/verification-v2/contracts/fixtures/positive/case-snapshot.json
- tests/verification-v2/contracts/fixtures/negative/test-case-missing-schema.json
- tests/verification-v2/contracts/fixtures/negative/case-snapshot-missing-schema.json
- tests/verification-v2/execution/**

## Interfaces / Seams

- The adapter executes and captures; reading and domain services own evaluation.

## Components To Create

- Execution orchestrator
- Command runner adapter

## Components To Reuse

- Runtime doctor
- Attempt contracts

## Components To Extract

- Child-process lifecycle and structured event emitter

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Acceptance assertion: `AC-14`.
- An approved command contract binds exact argv, project-relative cwd, and
  environment keys before execution. Attempts preserve immutable execution
  identity and append-only retry history while raw logs remain available for
  the downstream evidence store.

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

- `node --test tests/verification-v2/execution/command-adapter.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `004-contract-cross-references`, `008-runtime-doctor`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/009-command-runner`.
