# Task Brief: 005-case-planning-approval

## Goal

Reviewer can approve an immutable test-case snapshot before execution starts.

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
- openspec/changes/verification-2-0/specs/verification-contract-v2/spec.md

## Vertical Slice

Reviewer can approve an immutable test-case snapshot before execution starts. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Generate behavior-facing cases, six-domain mappings, evidence policies, snapshot hashes, and explicit user signoff.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/cases/**
- plugins/specnav-verification/skills/specnav-verify-plan/**
- tests/run-verification-v2-case-approval.sh
- tests/verification-v2/cases/**

## Interfaces / Seams

- Planning writes draft cases; approval writes a snapshot decision; execution reads only the approved snapshot.

## Components To Create

- Case planner
- Case snapshot writer
- Case approval validator

## Components To Reuse

- Requirements and acceptance artifacts
- Existing user-test-case signoff entry

## Components To Extract

- Case normalization and snapshot hashing

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-contract-v2/spec.md`.
- Acceptance assertions: `AC-01`, `AC-02`.
- Requirements and acceptance become proposed cases, reviewer approval binds a snapshot hash, and execution becomes legal.

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

- `node --test tests/verification-v2/cases/*.test.js`
- `bash tests/run-verification-v2-case-approval.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `003-contract-schemas`, `004-contract-cross-references`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/005-case-planning-approval`.
