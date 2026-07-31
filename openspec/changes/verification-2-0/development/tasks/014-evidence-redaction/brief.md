# Task Brief: 014-evidence-redaction

## Goal

Reviewer can inspect redacted logs and HTML without provider secrets leaking.

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

Reviewer can inspect redacted logs and HTML without provider secrets leaking. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Redact secrets from logs, model metadata, command output, JSON, Markdown, and HTML while preserving diagnostic structure.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/evidence/**
- plugins/specnav-verification/kernel/reporting/**
- plugins/specnav-verification/kernel/index.js
- tests/verification-v2/security/**
- tests/verification-v2/kernel/package-boundary.test.js
- openspec/changes/verification-2-0/tasks.md
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/drift-check.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**
- openspec/changes/verification-2-0/development/tasks/014-evidence-redaction/**

## Interfaces / Seams

- `createSecretRedactor()` returns safe text or structured values plus
  schema-compatible redaction metadata before persistence.
- `renderSafeHtmlText()` composes the redactor with HTML escaping for report
  projection and never accepts unredacted content as trusted.
- These are concrete Kernel utilities. They do not alter the frozen service
  contract digest or implement the later report-renderer service.

## Components To Create

- Secret redactor
- Redaction metadata contract
- Safe HTML text projector

## Components To Reuse

- Evidence writer
- Report model

## Components To Extract

- Shared safe-string and structured-value redaction

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Acceptance assertions: `AC-30`.
- Captured output passes redaction, records redaction status, and remains safe for report projection.
- Task 014 provides the host-neutral redaction boundary. Command, Playwright,
  and Midscene capture integration remains with their owning adapters and
  report-page composition remains Tasks 023 through 026.

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

- `node --test tests/verification-v2/security/redaction.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `012-evidence-store`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/014-evidence-redaction`.
