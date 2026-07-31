# Task Brief: 010-playwright-runner

## Goal

Reviewer can execute Playwright cases with assertions, traces, screenshots, video, console, and network evidence.

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

Reviewer can execute Playwright cases with assertions, traces, screenshots, video, console, and network evidence. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Run real browser cases through the managed Playwright runtime and collect deterministic assertion and browser evidence.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/execution/**
- plugins/specnav-verification/kernel/adapters/playwright-adapter.js
- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/kernel/runtime/doctor.js
- plugins/specnav-verification/kernel/runtime/installer.js
- plugins/specnav-verification/assets/runtime/verification-runtime-lock.json
- plugins/specnav-verification/schemas/test-case.schema.json
- tests/run-verification-v2-playwright.sh
- tests/verification-v2/browser/**
- tests/verification-v2/contracts/cross-reference/identity-bindings.suite.js
- tests/verification-v2/runtime/**
- openspec/changes/verification-2-0/tasks.md
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/drift-check.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**
- openspec/changes/verification-2-0/development/tasks/010-playwright-runner/**

## Interfaces / Seams

- Playwright assertions are deterministic execution observations. The adapter
  returns typed evidence candidates and references; Task 012 persists them and
  Task 015 converts valid evidence into verdict-bearing readings.

## Components To Create

- Playwright adapter
- Browser evidence collector

## Components To Reuse

- Execution orchestrator
- Managed browser runtime

## Components To Extract

- Browser project fingerprint and artifact normalizer

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Acceptance contribution: `AC-39`.
- Direct full-AC closures: none.
- Direct subclaim: `AC-39:playwright-adapter-boundary`.
- Contributes to: `AC-04`, `AC-06`, `AC-16`, `AC-31`, `AC-39`.
- Approved E2E case binds an exact scenario id and browser project, launches
  only the doctor-verified managed browser, executes deterministic assertions,
  and returns typed raw artifact candidates for the downstream EvidenceStore.
- Task 010 does not close runtime installation (`AC-04`), repair history
  (`AC-06`), Midscene oracle policy (`AC-16`), or persistent evidence records
  (`AC-31`).
- Task 010 stops at terminal attempt state, browser events, deterministic
  assertion observations, logs, and typed artifact candidates. It does not
  produce a verdict-bearing Reading, integrity verdict, retry/retest policy,
  domain aggregation, or release verdict.

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

- `bash tests/run-verification-v2-playwright.sh`
- `node --test tests/verification-v2/browser/playwright-adapter.test.js`

## Stop Conditions

- Stop if a dependency task is incomplete: `007-runtime-installer`, `008-runtime-doctor`, `009-command-runner`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/010-playwright-runner`.
