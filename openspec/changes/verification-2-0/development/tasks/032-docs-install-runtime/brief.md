# Task Brief: 032-docs-install-runtime

## Goal

User can install, configure, diagnose, and review Verification 2.0 from matched English and Chinese documentation.

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

User can install, configure, diagnose, and review Verification 2.0 from matched English and Chinese documentation. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Document full flow, no-light policy, runtime setup/doctor, Midscene oracle boundary, repair loop, reports, migration, host installation, blockers, and troubleshooting.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- README.md
- README.zh-CN.md
- docs/**
- plugins/specnav-verification/skills/**

## Interfaces / Seams

- Host-specific installation text differs, but Verification 2.0 semantics and diagrams remain aligned.

## Components To Create

- Matched English and Chinese Verification 2.0 documentation
- Updated workflow diagrams

## Components To Reuse

- Existing SpecNav visual style and README structure

## Components To Extract

- Shared documentation source facts and command snippets

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md`.
- Acceptance assertions: `AC-04`, `AC-05`, `AC-08`, `AC-09`, `AC-10`.
- User follows GitHub installation, runtime setup, case approval, execution, repair, report, and archive instructions.

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

- `bash tests/run-readme-contract.sh`
- `bash tests/run-verification-v2-docs.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `008-runtime-doctor`, `025-case-report-pages`, `028-codex-integration`, `029-claude-code-integration`, `030-codefree-o-integration`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/032-docs-install-runtime`.
