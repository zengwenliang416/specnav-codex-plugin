# Task Brief: 002-kernel-package-boundary

## Goal

Maintainer can install one shared Verification Kernel package without host-specific verdict logic.

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

Maintainer can install one shared Verification Kernel package without host-specific verdict logic. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Choose and implement the versioned kernel package boundary, public entrypoint, exports, and checksum/version metadata.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/**
- plugins/specnav-verification/package.json
- tests/verification-v2/kernel/**
- docs/verification-kernel-packaging.md

## Interfaces / Seams

- Host adapters may invoke the kernel entry but may not import internal modules or redefine verdict semantics.

## Components To Create

- Verification Kernel package
- Kernel public entry
- Kernel version contract

## Components To Reuse

- Existing plugin-runtime resolution pattern

## Components To Extract

- Host-neutral code from duplicated verification scripts

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md`.
- Acceptance assertions: `AC-36`, `AC-37`, `AC-39`, `AC-40`.
- Host invocation enters the public kernel API and receives structured results.
- Command execution, Playwright, Midscene, EvidenceStore, failure
  classification, and report rendering are exposed through explicit public
  adapter or service contracts rather than cross-module internal imports.

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

- `node --test tests/verification-v2/kernel/*.test.js`
- `node --check plugins/specnav-verification/kernel/index.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `001-baseline-fake-green`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/002-kernel-package-boundary`.
