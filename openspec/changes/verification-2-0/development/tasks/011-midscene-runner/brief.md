# Task Brief: 011-midscene-runner

## Goal

Reviewer can use Midscene for UI interaction while deterministic or human-approved oracles retain final verdict ownership.

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

Reviewer can use Midscene for UI interaction while deterministic or human-approved oracles retain final verdict ownership. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Capture Midscene interaction, model metadata, prompts, descriptions, screenshots, and deterministic-oracle linkage without storing secrets.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/adapters/midscene-adapter.js
- plugins/specnav-verification/kernel/adapters/playwright-adapter.js
- plugins/specnav-verification/kernel/execution/midscene-*.js
- plugins/specnav-verification/kernel/execution/playwright-api-guard.js
- plugins/specnav-verification/kernel/execution/playwright-worker.js
- plugins/specnav-verification/kernel/execution/orchestrator.js
- plugins/specnav-verification/kernel/execution/preflight.js
- plugins/specnav-verification/kernel/execution/index.js
- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/kernel/runtime/doctor.js
- plugins/specnav-verification/kernel/runtime/provider-contract.js
- plugins/specnav-verification/schemas/test-case.schema.json
- tests/verification-v2/midscene/**
- tests/verification-v2/kernel/package-boundary.test.js
- tests/verification-v2/runtime/doctor.test.js
- tests/run-verification-v2-midscene-contract.sh
- openspec/changes/verification-2-0/development/tasks/011-midscene-runner/**
- openspec/changes/verification-2-0/development/task-context.jsonl
- openspec/changes/verification-2-0/development/task-graph.json
- openspec/changes/verification-2-0/development/task-ledger.jsonl
- openspec/changes/verification-2-0/development/validation-log.jsonl
- openspec/changes/verification-2-0/development/evidence/**

## Interfaces / Seams

- Midscene may drive or describe the UI; Playwright assertions, structured facts, or approved human signoff own PASS.

## Components To Create

- Midscene adapter
- Oracle boundary validator

## Components To Reuse

- Playwright adapter
- Playwright managed-runtime, sandboxed-worker, browser-policy, and atomic
  artifact-publication infrastructure
- Runtime provider probe

## Components To Extract

- Model metadata normalization and secret-safe prompt capture
- Provider configuration fingerprinting shared by doctor and adapter
- Read-only Playwright API policy for deterministic Midscene oracles

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/evidence-backed-execution/spec.md`.
- Direct acceptance assertions: `AC-16`, `AC-39:midscene-adapter-boundary`.
- Reused constraints: `AC-05`, `AC-30`; their final closure remains with the
  reading, aggregation, reporting, and release tasks.
- Midscene performs interaction, emits evidence, and waits for a separate oracle reading before terminal evaluation.
- Provider credentials come only from the adapter's configured environment and
  must match the secret-free configuration fingerprint emitted by runtime
  doctor.
- Human signoff is requested only after the retained screenshot exists, and
  screenshot integrity is rechecked after the reviewer callback returns.

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

- `node --test tests/verification-v2/midscene/*.test.js tests/verification-v2/runtime/doctor.test.js`
- `bash tests/run-verification-v2-midscene-contract.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `007-runtime-installer`, `008-runtime-doctor`, `010-playwright-runner`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/011-midscene-runner`.
