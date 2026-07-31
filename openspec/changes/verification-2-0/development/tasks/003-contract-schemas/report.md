# Task Report: 003-contract-schemas

## Status

DONE

## Files Changed

- `plugins/specnav-verification/package.json`
- `plugins/specnav-verification/kernel/index.js`
- `plugins/specnav-verification/kernel/contracts/schema-registry.js`
- `plugins/specnav-verification/kernel/contracts/validate-fixtures.js`
- `plugins/specnav-verification/schemas/*.schema.json`
- `tests/verification-v2/contracts/schema-registry.test.js`
- `tests/verification-v2/contracts/package-content.test.js`
- `tests/verification-v2/contracts/fixtures/**`

## What Changed

- Added one versioned JSON Schema family for all 14 Verification Contract V2
  entities plus shared identity, result, domain, evidence, and policy
  definitions.
- Added a host-neutral schema registry that only loads AJV and `ajv-formats`
  from the doctor-approved managed runtime. Missing or mismatched runtime
  identity blocks validation; no global package or handwritten fallback exists.
- Added immutable validation results and exact blocker records containing the
  artifact path, entity type, JSON pointer field, keyword, schema path, and
  validation message.
- Exported the registry through the public Kernel entry and included the
  canonical `schemas/` directory in the published package.
- Added a fixture corpus with 14 valid entities, 47 single-defect invalid
  entities, and one shape-valid attempt with unresolved references reserved for
  Task 004.

## TDD Evidence

- RED evidence `035` records the initial failure because the schema registry
  module did not exist.
- Focused tests prove all entity schemas compile under strict AJV, every
  positive fixture passes, every negative fixture returns the expected field
  blocker, inputs are not mutated, and unresolved cross-entity references are
  not prematurely enforced.
- AC-31 is covered by one missing-field fixture for every required evidence
  identity field.
- AC-35 is covered by one missing-field fixture for every required gate
  decision provenance field.
- The package-content test executes `npm pack` and proves the published tarball
  contains the public entry, registry, and representative schemas without
  bundling `node_modules`.

## Verification Commands

- `node --test tests/verification-v2/contracts/*.test.js`
- `node plugins/specnav-verification/kernel/contracts/validate-fixtures.js`
- `node --check plugins/specnav-verification/kernel/contracts/schema-registry.js && node --check plugins/specnav-verification/kernel/contracts/validate-fixtures.js && git diff --check`

## Concerns

- The largest schema files are declarative contract data rather than
  executable complexity.
- Shape validation intentionally does not prove cross-entity existence,
  identity consistency, evidence file integrity, or retry classification.

## Scope Deviations

- None recorded.

## Follow-up Needed

- Task 004 must validate entity references, execution identity consistency, and
  retry fingerprint semantics without duplicating schema ownership.

## Adjudication

- Strict AJV remains enabled. Schema defects are fixed at their source instead
  of weakening the validator.
- `fallback_used` remains false throughout fixture validation.
- The implementation is ready for independent specification review followed by
  independent quality review.
