# Task Brief: 030-codefree-o-integration

## Goal

CodeFree-O user can discover and run the same Verification Kernel without losing existing local installation fixes.

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

CodeFree-O user can discover and run the same Verification Kernel without losing existing local installation fixes. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Add a thin CodeFree-O/OpenCode adapter while preserving pre-existing README and discovery-test changes in the downstream worktree.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- integrations/codefree-o/**
- tests/verification-v2/cross-host/**
- docs/host-integration-codefree-o.md

## Interfaces / Seams

- CodeFree-O adapter cannot overwrite unrelated local changes or fork kernel behavior.

## Components To Create

- CodeFree-O Verification 2.0 adapter

## Components To Reuse

- Shared kernel release
- Existing CodeFree-O discovery implementation

## Components To Extract

- CodeFree-O-only plugin registration and configuration lookup

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md`.
- Acceptance assertions: `AC-37`, `AC-40`.
- CodeFree-O discovers the adapter and emits the same normalized verification artifacts and blockers.

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

- `bash tests/run-verification-v2-codefree-o-adapter.sh`
- `bash /Volumes/zwl/AI/ai-coding/specnav-codefree-o-plugin/tests/run-smoke.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `028-codex-integration`, `029-claude-code-integration`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/030-codefree-o-integration`.
