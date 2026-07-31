# Spec Review: 003-contract-schemas

## Verdict

approved

## Direct Review Scope

- Task packet: `openspec/changes/verification-2-0/development/tasks/003-contract-schemas/brief.md`, `context.json`, `report.md`.
- Contract sources: `openspec/changes/verification-2-0/specs/verification-contract-v2/spec.md`, `openspec/changes/verification-2-0/acceptance.md`, `openspec/changes/verification-2-0/acceptance.json`.
- Package and public entry boundary: `plugins/specnav-verification/package.json:2-17`, `plugins/specnav-verification/kernel/index.js:3-16`.
- Schema implementation and validator: `plugins/specnav-verification/kernel/contracts/schema-registry.js:7-240`, `plugins/specnav-verification/kernel/contracts/validate-fixtures.js:35-130`, `plugins/specnav-verification/schemas/*.schema.json`.
- Focused tests and fixtures: `tests/verification-v2/contracts/schema-registry.test.js:79-269`, `tests/verification-v2/contracts/package-content.test.js:13-57`, `tests/verification-v2/contracts/fixtures/manifest.json:2-324`.
- Historical system receipts and ledger: `development/evidence/035-003-contract-schemas-red.log:1-44`, `036-003-contract-schemas.log:1-55`, `037-003-contract-schemas.log:1-220`, `038-003-contract-schemas.log`, `development/validation-log.jsonl:63-68`.
- Independent re-run executed by this review: `node --test tests/verification-v2/contracts/*.test.js` and `node plugins/specnav-verification/kernel/contracts/validate-fixtures.js`, both from repository root on July 31, 2026.

## Missing Requirements

- No missing requirement was found inside the Task 003 boundary.
- AC-13 is covered by 14 entity schemas with versioned `schema` constants and registry enumeration for `test-case`, `case-approval`, `case-snapshot`, `verification-run`, `attempt`, `reading`, `evidence`, `evidence-index`, `failure-packet`, `repair-link`, `runtime-status`, `report-model`, `gate-decision`, and `migration-receipt` in `plugins/specnav-verification/kernel/contracts/schema-registry.js:7-22,130-158` and `tests/verification-v2/contracts/fixtures/manifest.json:2-58`.
- The public package boundary required by this slice is present: `plugins/specnav-verification/package.json:5-14` publishes `kernel/` and `schemas/`, and `plugins/specnav-verification/kernel/index.js:3-16` exports `ENTITY_TYPES` and `createSchemaRegistry`.

## Extra Behavior

- The evidence schema is stricter than AC-31 alone: besides `id`, `kind`, `path`, `sha256`, `size`, `producer`, `captured_at`, `change_id`, `run_id`, `case_id`, `attempt_id`, `step_id/assertion_id`, `code_sha`, and `test_sha`, it also requires `environment_hash`, `runtime_version`, `kernel_version`, and `redaction` in `plugins/specnav-verification/schemas/evidence.schema.json:7-26,77-88`. This is compatible with the broader V2 contract and does not violate Task 003 scope.
- The gate schema is also stricter than AC-35 alone by additionally requiring `stage`, `decision`, `change_id`, `integrity_status`, `policy_version`, `blockers`, `warnings`, and `decided_at` in `plugins/specnav-verification/schemas/gate-decision.schema.json:7-24,35-103`. That is acceptable schema tightening for this vertical slice.
- `schema-registry.js` returns normalized immutable results and exact blocker objects with `artifact_path`, `field`, `keyword`, and `schema_path` in `plugins/specnav-verification/kernel/contracts/schema-registry.js:49-64,168-237`. This is useful extra behavior and aligns with the spec scenario that invalid entities fail with exact field blockers.

## Misunderstood Requirements

- No misunderstanding that blocks approval was found.
- The implementation preserves the user-specified boundary that cross-entity existence is not a Task 003 concern. `tests/verification-v2/contracts/schema-registry.test.js:253-269` explicitly validates that a shape-valid attempt with unresolved references still passes schema validation, reserving that check for Task 004 rather than overreaching here.

## Cannot Verify From Diff

- I cannot prove from Task 003 files alone that every future kernel service calls the schema registry before all reads and writes. The packet states that seam in prose, but this task only introduces the public entry, registry, schemas, fixtures, and package boundary.
- I can verify the evidence schema accepts `step_id` or `assertion_id` via `anyOf` in `plugins/specnav-verification/schemas/evidence.schema.json:104-125`, but the provided positive baseline fixture uses the `step_id` branch only in `tests/verification-v2/contracts/fixtures/ac31/evidence-baseline.json`. There is no separate positive assertion-only fixture in this slice.
- `openspec/changes/verification-2-0/acceptance.json` still marks AC-13, AC-31, and AC-35 as `failing`; per review boundary, that lifecycle status is not treated as an implementation defect because the acceptance ledger is updated by the broader verification closure, not by Task 003 alone.

## Acceptance Assertions Verified

- `AC-13` verified. Versioned schemas exist for every entity named by the assertion; the registry enumerates and compiles all fourteen schemas, the package publishes the schema directory and public registry entry, and the focused positive and negative fixture tests pass.
- `AC-31` verified. The evidence schema requires stable identity, artifact metadata, producer, timestamp, change, run, case, attempt, either a step or assertion binding, and code and test source identifiers; missing-field fixtures return the exact blocker path.
- `AC-35` verified. The gate decision schema requires source cases and readings, evidence index version, runtime version, kernel version, and freshness result; missing-field fixtures return the exact blocker path.

## Independent Re-Run

- `node --test tests/verification-v2/contracts/*.test.js`
  - Exit status: `0`.
  - Result: 6/6 tests passed in this review run, including package content, full entity compilation, negative blocker precision, direct AC-31/AC-35 field enforcement, managed-AJV/no-mutation behavior, and the Task 004 unresolved-reference boundary.
- `node plugins/specnav-verification/kernel/contracts/validate-fixtures.js`
  - Exit status: `0`.
  - Result: JSON output reported `"ok": true`, `"blockers": []`, `runtime_version: "2.0.0-alpha.1"`, all 14 positive fixtures accepted, all negative fixtures rejected at the expected field, and `"fallback_used": false`.
- Historical system-executed evidence is consistent with the current state:
  - RED baseline `035` captures the pre-implementation module-missing failure in `development/evidence/035-003-contract-schemas-red.log:1-44`.
  - Receipts `036` and `037` record system-executed passing runs for the same two commands on July 31, 2026 in `development/evidence/036-003-contract-schemas.log:1-55` and `development/evidence/037-003-contract-schemas.log:1-220`.
  - `development/validation-log.jsonl:66-68` records those passes with `attestation: "system-executed"` and `overturned: false`.

## Findings

- No blocking findings.
- I found no Task 003 boundary violation where schema code tried to implement Task 004+ semantics such as cross-entity reference existence, SHA consistency, file hash/size verification, retry fingerprint enforcement, or verdict derivation. The unresolved-reference guard test in `tests/verification-v2/contracts/schema-registry.test.js:253-269` is the direct evidence for that restraint.

## Required Fixes

- No implementation or contract fixes are required for Task 003 after this review.
