# Task Brief: 007-runtime-installer

## Goal

Verification operator can explicitly install Playwright, browsers, Midscene, and AJV outside the business repository.

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
- openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md

## Vertical Slice

Verification operator can explicitly install Playwright, browsers, Midscene, and AJV outside the business repository. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Install a side-by-side runtime, lock packages, install browser binaries, write receipts, and leave project manifests unchanged.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/runtime/**
- plugins/specnav-verification/scripts/verification-runtime.js
- plugins/specnav-verification/skills/specnav-verification-runtime-setup/**
- tests/verification-v2/runtime/**

## Interfaces / Seams

- Only the explicit setup command writes the managed runtime; stage hooks and ordinary verification remain read-only toward runtime installation.

## Components To Create

- Explicit runtime installer
- Install receipt
- Runtime setup skill

## Components To Reuse

- Runtime manifest and lock resolver

## Components To Extract

- Filesystem transaction and receipt writer

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md`.
- Acceptance assertions: `AC-04`, `AC-05`.
- User action resolves a locked version, installs into the managed root, verifies files, and writes a receipt.

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

- `bash tests/run-verification-runtime-install.sh`
- `node --test tests/verification-v2/runtime/installer.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `006-runtime-lock-manifest`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/007-runtime-installer`.
