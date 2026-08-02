# Task Brief: 027-v1-v2-migration

## Goal

Maintainer can dry-run, back up, migrate, validate, and roll back V1 verification artifacts without fake PASS.

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

Maintainer can dry-run, back up, migrate, validate, and roll back V1 verification artifacts without fake PASS. The delivered slice must be directly demonstrable through the
listed verification commands and must preserve all earlier artifacts.

## In Scope

- Distinguish non-SQL artifact migration from database migration, preserve V1 backup, transform provable facts, block unverifiable green, and write receipts.

## Out Of Scope

- Later task groups and host integrations not listed in this packet.
- Silent fallback, verification light mode, business-project dependency mutation, and invented evidence.
- Closing this task without direct system-executed validation.

## Files Allowed

- plugins/specnav-verification/kernel/migration/**
- plugins/specnav-verification/kernel/index.js
- plugins/specnav-verification/scripts/verification-migrate.js
- plugins/specnav-development/scripts/development-contract.js
- tests/run-development-plugin-fixtures.sh
- tests/verification-v2/migration/**
- tests/verification-v2/kernel/package-boundary.test.js
- tests/run-verification-v2-migration.sh

## Interfaces / Seams

- Migration never runs implicitly and never writes business database migrations.

## Components To Create

- V1-to-V2 migrator
- Migration receipt
- Migration dry-run report

## Components To Reuse

- V2 schemas
- Evidence integrity checker

## Components To Extract

- Artifact backup/restore and migration-step registry

## Pre-Edit Complexity Check

- Safer edit boundary: one host-neutral migration owner, one artifact
  backup/restore owner, one transformation registry, and one thin CLI.
- Decision: add owner files under `kernel/migration/`; extend the Kernel public
  entry and package-boundary test; do not add migration branches to Evidence
  Store, DecisionEngine, or host adapters.

## API / Data Flow Contracts

- Capability spec: `openspec/changes/verification-2-0/specs/cross-host-verification-governance/spec.md`.
- Acceptance assertions: `AC-32`, `AC-33`, `AC-34`.
- User requests dry run, reviews findings, creates backup, transforms artifacts, validates V2, and retains rollback.

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

- `node --test tests/verification-v2/migration/*.test.js`
- `bash tests/run-verification-v2-migration.sh`

## Stop Conditions

- Stop if a dependency task is incomplete: `003-contract-schemas`, `013-evidence-integrity`, `016-six-domain-aggregation`.
- Stop if the task requires files outside `scope.json` or a downstream repository has unresolved local changes.
- Stop if a required runtime, browser, provider configuration, schema, evidence object, or user approval is missing.
- Stop if implementation would duplicate host-neutral kernel behavior.

## Unsafe Assumptions

- A package being installed does not prove its browser binary or provider configuration works.
- A green string, screenshot path, Midscene description, or agent narrative is not PASS evidence.
- HTML is not the source of truth.
- Existing V1 green artifacts are not automatically valid V2 evidence.

Task packet path: `openspec/changes/verification-2-0/development/tasks/027-v1-v2-migration`.
