# Task Brief: 022-case-rerun-impact

## Goal

Verification operator can rerun concrete impacted cases plus mandatory baselines using CodeGraph and policy evidence.

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
- openspec/changes/verification-2-0/specs/verification-repair-loop/spec.md

## Vertical Slice

Verification operator can rerun concrete impacted cases plus mandatory baselines using CodeGraph and policy evidence. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Map changed files, requirements, CodeGraph impact, and policy baselines to exact case ids and reasons.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/repair/**
- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/scripts/rerun-scope.js
- plugins/specnav-verification/skills/specnav-verify-rerun/**
- plugins/specnav-codegraph/**
- tests/verification-v2/rerun/**
- tests/verification-v2/kernel/package-boundary.test.js
- tests/run-verification-v2-codegraph-rerun.sh
- openspec/changes/verification-2-0/tasks.md
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/drift-check.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**
- openspec/changes/verification-2-0/development/tasks/022-case-rerun-impact/**

## Interfaces / Seams

- `createCaseRerunPlanner()` consumes an approved case catalog, exact changed
  files, traceability entries, case freshness facts, repaired case ids,
  mandatory baseline case ids, and optional CodeGraph impact evidence.
- The planner returns deterministic `cases_to_rerun` entries with exact reasons.
- The planner computes scope only. Task 020 owns retest and regression
  execution, lifecycle transitions, and failure closure.
- CodeGraph may add impact evidence but may not remove mandatory baseline cases.

## Components To Create

- Case-level rerun planner
- Rerun scope report

## Components To Reuse

- CodeGraph impact report
- Case catalog
- Freshness evaluator

## Components To Extract

- Impact-to-case mapping and baseline policy

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-repair-loop/spec.md`.
- Acceptance assertions: `AC-24`, `AC-26`.
- Change impact plus stale cases plus policy baselines produce a concrete retest/regression case list.
- Repaired cases and mandatory baselines are always retained.
- Unmapped production changes conservatively select every approved case.
- Unknown case references, malformed impact evidence, and missing required
  inputs fail closed instead of silently shrinking rerun scope.

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

- `node --test tests/verification-v2/rerun/*.test.js`
- `bash tests/run-verification-v2-codegraph-rerun.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `005-case-planning-approval`, `021-case-freshness`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/022-case-rerun-impact`.
