# Task Brief: 013-evidence-integrity

## Goal

Release owner can see missing, tampered, stale, or incorrectly bound evidence block green.

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

Release owner can see missing, tampered, stale, or incorrectly bound evidence block green. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Validate path containment, existence, hash, size, producer, identity binding, source fingerprints, and freshness.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/evidence/**
- plugins/specnav-verification/kernel/index.js
- tests/verification-v2/evidence/**
- tests/verification-v2/negative/**
- tests/verification-v2/kernel/package-boundary.test.js
- tests/run-verification-v2-negative.sh
- openspec/changes/verification-2-0/tasks.md
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/drift-check.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**
- openspec/changes/verification-2-0/development/tasks/013-evidence-integrity/**

## Interfaces / Seams

- `createEvidenceIntegrityChecker()` returns integrity and freshness facts to
  later reading and gate services and never edits source evidence.
- The checker is a concrete Kernel factory. Adding a new frozen service
  contract requires an explicit API and contract version upgrade.

## Components To Create

- Evidence integrity checker
- Broken-evidence blocker mapping

## Components To Reuse

- EvidenceStore
- Cross-reference validator

## Components To Extract

- Path containment, checksum, and evidence-binding utilities

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Direct acceptance assertion: `AC-17`.
- Acceptance subclaims: `AC-18:empty-evidence`,
  `AC-23:evidence-fingerprint-freshness`, and
  `AC-28:evidence-integrity-blockers`.
- Reading references resolve to evidence objects; any failed integrity check blocks the reading and release.
- Task 013 returns facts and blockers only. Reading verdict ownership remains
  Task 015, case freshness remains Task 021, and release/archive enforcement
  remains Task 033.

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

- `node --test tests/verification-v2/evidence/integrity.test.js`
- `bash tests/run-verification-v2-negative.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `004-contract-cross-references`, `012-evidence-store`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/013-evidence-integrity`.
