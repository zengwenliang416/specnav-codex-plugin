# Task Brief: 033-release-archive-proof

## Goal

Release owner can prove clean GitHub installation, full six-domain evidence, three reports, and archive readiness across all hosts.

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

Release owner can prove clean GitHub installation, full six-domain evidence, three reports, and archive readiness across all hosts. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Require V2 freshness, integrity, closed repairs, reports, migration, clean host installation, compatibility, release, rollback, and archive evidence.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-operations/**
- tests/verification-v2/release/**
- docs/release-verification-v2.md
- .github/workflows/ci.yml
- tests/run-verification-v2-release.sh
- tests/run-verification-v2-cross-host.sh
- tests/run-smoke.sh
- tests/run-light-compact-gate-fixtures.sh
- tests/run-operations-plugin-fixtures.sh
- tests/run-operations-archive-action-fixtures.sh
- tests/verification-v2/cross-host/host-lock.json

The additive runner and regression-fixture scope is recorded in
`scope-correction.json`.

## Interfaces / Seams

- Operations treats persisted gates as untrusted release artifacts. It reruns
  the public Kernel six-domain aggregator and DecisionEngine from
  `verify/v2/gate-input.json`, compares the recomputed identities and decisions
  with the persisted gates, and never edits Readings or owns verdict semantics.

## Components To Create

- Verification 2.0 release gate
- Verification 2.0 archive gate proof

## Components To Reuse

- Existing operations and archive actions
- Cross-host drift results

## Components To Extract

- Shared release evidence receipt and clean-install verifier

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md`.
- Acceptance assertions: `AC-03`, `AC-28`, `AC-29`, `AC-33`, `AC-35`, `AC-37`.
- Clean host installs run the canonical change, produce all six domains and reports, then operations proves release and archive readiness.

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

- `bash tests/run-verification-v2-release.sh`
- `bash tests/run-verification-v2-cross-host.sh`
- `bash tests/run-operations-archive-action-fixtures.sh`
- `bash tests/run-operations-plugin-fixtures.sh`
- `npm test`
- `node --test $(find tests/verification-v2 -type f -name '*.test.js' | sort)`

## Stop Conditions

- Stop if a dependency task is incomplete: `020-retest-regression-loop`, `026-report-accessibility-security`, `027-v1-v2-migration`, `031-cross-host-drift-ci`, `032-docs-install-runtime`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/033-release-archive-proof`.
