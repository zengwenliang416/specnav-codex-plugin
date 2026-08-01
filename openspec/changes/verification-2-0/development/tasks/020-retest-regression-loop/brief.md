# Task Brief: 020-retest-regression-loop

## Goal

Reviewer can distinguish retry, retest, and regression and close a failure only after required regression passes.

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

Reviewer can distinguish retry, retest, and regression and close a failure only after required regression passes. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Implement attempt-kind eligibility, immutable history, pass-after-fix and flaky
  labels, regression closure readiness, reopen proposals, and break-loop routing
  proposals.
- Consume Task 004 retry identity validation and Task 022 concrete rerun scope
  without redefining either contract.
- Keep every lifecycle transition proposal host-neutral and Core-owned.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/repair/**
- plugins/specnav-verification/kernel/execution/**
- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/schemas/**
- tests/verification-v2/repair-loop/**
- tests/verification-v2/contracts/**
- tests/verification-v2/kernel/package-boundary.test.js
- tests/run-verification-v2-repair-loop.sh
- openspec/changes/verification-2-0/development/tasks/020-retest-regression-loop/**
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-graph.json
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**
- openspec/changes/verification-2-0/tasks.md

## Interfaces / Seams

- Execution records attempts; the repair-loop state machine derives legal next
  actions and immutable labels; Core consumes transition proposals and remains
  the only lifecycle transition authority.

## Components To Create

- Repair-loop state machine
- Failure closure validator
- Versioned Core transition-proposal contract

## Components To Reuse

- Execution orchestrator
- Rerun planner
- Task 004 retry identity validator
- Task 018 frozen classification result and break-loop-required signal
- Task 019 completed repair link
- Existing Core break-loop governance

## Components To Extract

- Attempt transition table and immutable lifecycle history projection

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/verification-repair-loop/spec.md`.
- Direct acceptance assertions: `AC-06`, `AC-07`, `AC-27`.
- Regression assertions for already-owned contracts: `AC-15`, `AC-26`.
- Task 004 retains retry-fingerprint ownership for `AC-15`.
- Task 022 retains concrete regression-scope ownership for `AC-26`; this task
  must consume the exact repaired, impacted, and baseline case set.
- The Kernel may propose close, reopen, repair, retest, regression, or
  break-loop routing, but only Core may execute those lifecycle transitions.
- Initial failure moves through classification, repair, retest, regression, and
  a Core-owned closure, reopen, or break-loop transition.

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

- `node --test tests/verification-v2/repair-loop/state-machine.test.js`
- `bash tests/run-verification-v2-repair-loop.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `018-failure-classification`, `019-development-repair-bridge`, `022-case-rerun-impact`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/020-retest-regression-loop`.
