# Task Brief: 031-cross-host-drift-ci

## Goal

Release owner can detect cross-host kernel, schema, blocker, fixture, and generated-artifact drift in CI.

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
- openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md

## Vertical Slice

Release owner can detect cross-host kernel, schema, blocker, fixture, and generated-artifact drift in CI. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Compare kernel versions, schema checksums, blocker registries, normalized fixtures, and report model output across hosts.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- tests/verification-v2/cross-host/**
- .github/workflows/ci.yml
- plugins/specnav-verification/kernel/**

## Interfaces / Seams

- CI detects drift and blocks release; it does not auto-rewrite downstream repositories.

## Components To Create

- Cross-host drift detector
- CI compatibility job

## Components To Reuse

- Shared fixture corpus
- Host installation evidence

## Components To Extract

- Canonical normalization and checksum comparison

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md`.
- Acceptance assertions: `AC-37`, `AC-39`, `AC-40`.
- Each host runs the canonical corpus and CI compares normalized outputs against the kernel reference.
- Static architecture checks reject direct internal imports or duplicated
  implementations that bypass the command, browser, AI interaction, evidence,
  repair, or reporting boundaries defined by the Verification Kernel.

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

- `bash tests/run-verification-v2-cross-host.sh`
- `npm test`

## Stop Conditions

- Stop if a dependency task is incomplete: `028-codex-integration`, `029-claude-code-integration`, `030-codefree-o-integration`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/031-cross-host-drift-ci`.
