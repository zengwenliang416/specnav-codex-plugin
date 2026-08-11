# Quality Review: 003-contract-schemas

## Verdict

approved

## Separation Of Concerns

- `plugins/specnav-verification/kernel/contracts/schema-registry.js:112-247` keeps the runtime boundary, AJV bootstrapping, schema compilation, and validation API in one host-neutral registry without mixing downstream integrity, repair, or host install behavior.
- `plugins/specnav-verification/kernel/contracts/validate-fixtures.js:35-130` is correctly scoped to fixture-corpus verification. It derives the managed runtime through `doctorRuntime()` and `loadRuntimeLock()`, then exercises the registry; it does not duplicate schema logic.
- `plugins/specnav-verification/kernel/index.js:3-16` exposes only the intended public seam: metadata, service contracts, service factory, entity list, and schema registry.
- `plugins/specnav-verification/package.json:5-14` preserves the package boundary required by the brief by publishing only `kernel/` and `schemas/`, with explicit exports for `.` and `./schemas/*`.
- The implementation stays within Task 003 scope. `tests/verification-v2/contracts/schema-registry.test.js:253-269` explicitly proves unresolved cross-entity references remain Task 004 responsibility instead of being smuggled into this slice.

## Component Cohesion / Coupling

- Cohesion is high. `schema-registry.js` owns one responsibility: compile the schema family through managed AJV and return normalized validation results.
- Coupling is intentionally narrow. The registry depends only on a doctor-approved runtime root plus the schema directory; it does not depend on host adapters, filesystem layouts outside explicit inputs, or global `node_modules`.
- Common fragments were extracted in a reasonable place. `plugins/specnav-verification/schemas/common.schema.json:5-220` centralizes stable ids, semver, hashes, relative paths, reviewer/blocker/action fragments, kernel identity, and freshness/redaction fragments that are reused across the entity schemas.
- The shared fragment extraction is not overdone. The entity schemas remain readable and retain entity-specific fields locally, for example `evidence.schema.json:7-125` and `gate-decision.schema.json:7-105`, instead of hiding core contract meaning behind excessive indirection.

## Test Quality

- The focused suite materially resists fake-green outcomes. `tests/verification-v2/contracts/schema-registry.test.js:79-121` compiles and validates all 14 entity types listed in `tests/verification-v2/contracts/fixtures/manifest.json:2-58`, preventing a partial registry from passing.
- Negative coverage is meaningful, not narrative-only. `schema-registry.test.js:123-154` checks every negative fixture for failed validation plus exact `artifact_path` and expected JSON-pointer field.
- AC-31 and AC-35 are tested directly at the schema API level, not only through fixture narration. `schema-registry.test.js:156-198` deletes each required field from the evidence and gate baselines and asserts exact blocker paths.
- Managed-AJV-only and input immutability are explicitly tested in `schema-registry.test.js:201-251`, including the failure path when the runtime is not ready and when AJV is absent from the managed runtime root.
- Publication boundary is exercised by `tests/verification-v2/contracts/package-content.test.js:13-57`, which runs `npm pack` and verifies the tarball contains the public entry, registry, and representative schemas while excluding `node_modules`.
- The fixture validator is slightly less strict than the direct test suite because `validate-fixtures.js:88-98` only checks the expected field for negative fixtures, not keyword/message/schema path. That is acceptable here because `schema-registry.test.js:133-152` already asserts blocker structure and exact artifact linkage, so this does not create a material fake-green gap.

## Error Handling

- Runtime preconditions fail closed. `schema-registry.js:82-110` rejects non-ready runtime status, missing managed roots, missing doctor-reported roots, and realpath mismatches with specific `verification-contract:*` error codes instead of falling back to ambient dependencies.
- Managed AJV loading also fails closed. `schema-registry.js:67-80` uses `createRequire(path.join(runtimeRoot, 'package.json'))` and throws `verification-contract:managed-ajv-unavailable:*` on any load failure.
- Schema compilation failures are normalized into `verification-contract:schema-registry-invalid:*` in `schema-registry.js:137-148`, which is the correct boundary for malformed schema assets.
- Validation failures are precise. `schema-registry.js:49-64` emits blocker objects with `artifact_path`, `entity_type`, `field`, `keyword`, `schema_path`, and `message`, and sorts them deterministically.
- JSON parse failures are also explicit. `schema-registry.js:201-225` returns `verification-contract:artifact-json-invalid` with the resolved artifact path and parse message rather than throwing opaque syntax exceptions into callers.

## Reuse / Duplication

- Reuse is appropriate and local. The entity schemas share common fragments through `common.schema.json` instead of repeating id/hash/date/path primitives across 14 files.
- The registry avoids repeated per-entity branching by enumerating `ENTITY_TYPES` once in `schema-registry.js:7-22` and deriving schema files and validators from that list in `schema-registry.js:130-158`.
- There is some intentional duplication in the fixture corpus, especially the one-defect-per-file AC-31 and AC-35 negatives in `tests/verification-v2/contracts/fixtures/manifest.json:60-295`. That duplication is justified because it isolates exact missing-field failures and makes false positives easier to diagnose.
- I did not find copy-paste duplication that should have been extracted into additional runtime code. Further abstraction here would likely reduce clarity more than it would reduce maintenance cost.

## Complexity Delta

- Executable complexity remains modest. The main behavior lives in two small modules: `schema-registry.js` and `validate-fixtures.js`.
- The larger surface area is declarative schema data, not branching logic. That is the expected complexity shape for this task.
- The code avoids over-engineering: no custom validator DSL, no fallback validator, no schema-generation pipeline, and no host-specific adapter layer were introduced.
- The remaining complexity is proportional to the brief because the task must cover 14 entities, public packaging, fixture validation, and managed-runtime-only schema compilation.

## Security / Runtime Boundary

- The managed-runtime boundary is real, not narrative. `schema-registry.js:118-120` calls `assertManagedRuntime()` before loading AJV, and `schema-registry.js:67-80` resolves AJV from the approved runtime root only.
- `assertManagedRuntime()` compares realpaths for the requested runtime root and the doctor-reported runtime root in `schema-registry.js:90-109`, which blocks alias-path drift and accidental fallback to a different installation tree.
- The schema family itself is host-neutral. The contract files under `plugins/specnav-verification/schemas/*.schema.json` define data shape only and do not encode host commands, environment probing, or install logic.
- Path safety is reasonable for this slice. Artifact references inside schemas use `common.schema.json:30-34` to forbid absolute paths, drive-letter paths, backslashes, and `..` traversal. Module loading uses `createRequire` anchored to an approved runtime package root rather than ambient resolution.
- I found no silent fallback, shell injection surface, dynamic `eval`, or mutable global singleton hidden inside the validation path.

## Direct Evidence

- Task brief confirms the required boundary and stop conditions for managed AJV only, no fallback, and package export requirements in `openspec/changes/verification-2-0/development/tasks/003-contract-schemas/brief.md:63-100`.
- Approved spec review already accepted the task scope and acceptance mapping in `openspec/changes/verification-2-0/development/tasks/003-contract-schemas/spec-review.md:3-66`.
- Historical RED evidence is real: `openspec/changes/verification-2-0/development/evidence/035-003-contract-schemas-red.log:1-44` records the initial `MODULE_NOT_FOUND` failure before the registry existed.
- Historical system-executed green receipts are real:
  - `openspec/changes/verification-2-0/development/evidence/036-003-contract-schemas.log:1-55` shows 6/6 tests passed.
  - `openspec/changes/verification-2-0/development/evidence/037-003-contract-schemas.log:1-367` shows fixture validation returned `"ok": true` and `"fallback_used": false`.
  - `openspec/changes/verification-2-0/development/evidence/038-003-contract-schemas.log:1-9` shows syntax checks and `git diff --check` passed.
- The validation ledger matches those receipts with `attestation: "system-executed"` and `overturned: false` in `openspec/changes/verification-2-0/development/validation-log.jsonl:66-68`.
- I independently reran the required commands on July 31, 2026 from repository root:
  - `node --test tests/verification-v2/contracts/*.test.js` -> exit `0`, 6 tests passed.
  - `node plugins/specnav-verification/kernel/contracts/validate-fixtures.js` -> exit `0`, `ok: true`, `blockers: []`, `fallback_used: false`.
  - `node --check plugins/specnav-verification/kernel/contracts/schema-registry.js && node --check plugins/specnav-verification/kernel/contracts/validate-fixtures.js && git diff --check` -> exit `0`.

## Acceptance Assertions Verified

- AC-13
- AC-31
- AC-35

## Required Fixes

- No code or test changes are required for Task 003 after this review.
