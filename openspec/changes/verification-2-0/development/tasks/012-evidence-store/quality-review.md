# Quality Review: 012-evidence-store

## Verdict

approved

## Findings

No blocking findings.

## Separation Of Concerns

- `raw-store.js` owns append-only JSONL and locking.
- `content-addressed-writer.js` owns immutable object publication.
- `index-builder.js` owns deterministic derived index/cache publication.
- `evidence-store.js` owns validation and the public concrete API.

## Component Cohesion / Coupling

- Identity, path validation, blockers, raw storage, object storage, and index
  publication are extracted behind narrow host-neutral modules.
- The implementation reuses the managed Schema Registry and does not duplicate
  downstream integrity, redaction, or verdict logic.

## Test Quality

- Focused system-executed validation passed 33/33.
- Full Verification V2 regression passed 242/242.
- Tests cover failed-then-pass retention, deterministic rebuild, idempotency,
  source and store path escapes, raw/object symlinks, CAS conflicts, stale
  indexes, publication rollback, short writes, lock contention, non-JSON
  candidates, and forced object publication failure.

## Error Handling

- Filesystem failures return exact blockers with error code, message, and
  target where available.
- Object publication failure cannot create a raw claim.
- Index/cache publication races roll back derived artifacts while preserving
  raw source truth.

## Reuse / Duplication

- Reuses canonical hashing, the Kernel Schema Registry, and shared blocker
  structures.
- No host-specific or fallback implementation was introduced.

## Complexity Delta

- The extra modules are justified by independent append, CAS, index, and path
  security responsibilities.
- The frozen service contract and contract digest remain stable.

## Validation Results

- Focused EvidenceStore, Kernel, and Schema tests: 33/33 passed.
- Full Verification V2: 242/242 passed.
- Verification plugin fixtures: passed.
- Development plugin fixtures: passed.
- Managed runtime doctor: ready, no fallback used.
- Static syntax and diff checks: passed.

## Acceptance Assertions Verified

- AC-22
- AC-31
- AC-32:evidence-store-retention

## Required Fixes

- No further quality fix is required for Task 012 after append, object
  publication, deterministic index rebuild, and fail-closed lookup coverage
  passed.
