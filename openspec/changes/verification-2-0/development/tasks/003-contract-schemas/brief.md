# Task Brief: 003-contract-schemas

## Goal

Plugin author can validate every V2 entity through versioned JSON Schemas.

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

Plugin author can validate every V2 entity through versioned JSON Schemas. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Define schemas for cases, approvals, snapshots, runs, attempts, readings, evidence, failures, runtime, reports, gates, and migration receipts.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/package.json
- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/kernel/contracts/**
- plugins/specnav-verification/schemas/**
- tests/verification-v2/contracts/**

## Interfaces / Seams

- All kernel services validate through the schema registry before reading or writing an entity.

## Components To Create

- V2 JSON Schema family
- Schema registry
- Positive and negative schema fixtures

## Components To Reuse

- AJV validation conventions

## Components To Extract

- Common identity and artifact-reference schema fragments

## Packaging Boundary

- The public Kernel entry exports the schema registry.
- The package manifest includes the canonical `schemas/` directory.
- Schema ownership remains in this task; no host adapter receives a copied
  schema family.

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-contract-v2/spec.md`.
- Acceptance assertions: `AC-13`, `AC-31`, `AC-35`.
- JSON input passes schema resolution and returns normalized entity or exact field blockers.

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

- `node --test tests/verification-v2/contracts/*.test.js`
- `node plugins/specnav-verification/kernel/contracts/validate-fixtures.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `002-kernel-package-boundary`,
  `008-runtime-doctor`.
- Stop if managed AJV is unavailable; do not use a global package, moving
  `npx`, cached dependency, or hand-written fallback validator.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/003-contract-schemas`.
