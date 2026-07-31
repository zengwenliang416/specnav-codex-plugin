# Task Brief: 012-evidence-store

## Goal

Reviewer can retain append-only evidence objects and rebuild the summary index without losing failed attempts.

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

Reviewer can retain append-only evidence objects and rebuild the summary index without losing failed attempts. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Write raw JSONL, content-addressed objects, summary indexes, cache metadata, and immutable evidence ids.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/evidence/**
- tests/verification-v2/evidence/**

## Interfaces / Seams

- Adapters submit typed evidence; consumers query ids through EvidenceStore instead of arbitrary paths.

## Components To Create

- EvidenceStore
- Raw evidence writer
- Summary index builder

## Components To Reuse

- Evidence schema
- Stable id and hash utilities

## Components To Extract

- Atomic append and content-addressed object writer

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Acceptance assertions: `AC-22`, `AC-31`, `AC-32`.
- Runner output becomes immutable evidence, raw records remain source truth, and indexes rebuild deterministically.

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

- `node --test tests/verification-v2/evidence/evidence-store.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `003-contract-schemas`, `009-command-runner`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/012-evidence-store`.
