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
- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/kernel/contracts.js
- tests/verification-v2/evidence/**
- tests/verification-v2/kernel/package-boundary.test.js
- openspec/changes/verification-2-0/tasks.md
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/drift-check.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**
- openspec/changes/verification-2-0/development/tasks/012-evidence-store/**

## Interfaces / Seams

- Adapters submit typed evidence with explicit step or assertion binding.
- The frozen Kernel service contract remains `append` and `rebuildIndex`.
- The concrete object returned by `createEvidenceStore()` additionally exposes
  `getById` and `resolve` for current in-process consumers. Promoting those
  methods into the service contract requires an explicit API and contract
  version upgrade.

## Components To Create

- EvidenceStore
- Raw evidence writer
- Summary index builder

## Components To Reuse

- Evidence schema
- Stable id and hash utilities

## Components To Extract

- Atomic append and content-addressed object writer
- Stable evidence identity and strict raw JSONL parser

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Direct acceptance assertions: `AC-22`, `AC-31`.
- Acceptance contribution: `AC-32:evidence-store-retention`.
- Runner output becomes immutable evidence, raw records remain source truth, and indexes rebuild deterministically.
- Exact duplicate append requests are idempotent and do not add another raw
  line. The same bytes under a different attempt produce a distinct evidence
  id while reusing the same content-addressed object.
- Task 012 never invents a step or assertion binding for an adapter candidate.
- Full `AC-32` closure remains with migration, report, release, and archive
  tasks that prove the same failed evidence survives those lifecycle steps.

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
