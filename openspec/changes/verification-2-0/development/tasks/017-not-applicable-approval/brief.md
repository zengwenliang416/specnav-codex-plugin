# Task Brief: 017-not-applicable-approval

## Goal

Reviewer can approve a domain as not applicable only with reason and evidence.

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
- openspec/changes/verification-2-0/specs/six-domain-evaluation/spec.md

## Vertical Slice

Reviewer can approve a domain as not applicable only with reason and evidence. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Implement not-applicable policy, reviewer identity, reason, evidence, approval timestamp, and stale-approval behavior.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/evaluation/**
- plugins/specnav-verification/kernel/cases/**
- plugins/specnav-verification/kernel/index.js
- tests/verification-v2/evaluation/**
- tests/verification-v2/kernel/package-boundary.test.js
- openspec/changes/verification-2-0/development/tasks/017-not-applicable-approval/**
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-graph.json
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**

## Interfaces / Seams

- Case planner proposes applicability; reviewer approves; aggregator consumes only valid decisions.

## Components To Create

- Not-applicable decision validator

## Components To Reuse

- Case approval contract
- Six-domain aggregator

## Components To Extract

- Approval identity and freshness checks

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/six-domain-evaluation/spec.md`.
- Direct acceptance assertion: `AC-20`.
- Contribution assertion: `AC-19` for the validated `not_applicable` terminal
  branch; Task 016 retains complete six-domain terminal-result ownership.
- A non-applicable domain remains blocked until policy, reason, evidence, and approval are all valid.

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

- `node --test tests/verification-v2/evaluation/not-applicable.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `005-case-planning-approval`, `016-six-domain-aggregation`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/017-not-applicable-approval`.
