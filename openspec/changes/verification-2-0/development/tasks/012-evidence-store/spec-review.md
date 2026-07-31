# Spec Review: 012-evidence-store

## Verdict

approved

## Missing Requirements

- No requirement is missing from the Task 012 append-only EvidenceStore
  boundary; integrity, redaction, and verdict derivation remain downstream.

## Extra Behavior

- No integrity verdict, redaction, Reading, six-domain aggregation, report,
  host integration, release, archive, fallback, or simplified mode was added.

## Misunderstood Requirements

- The original packet incorrectly described concrete `getById/resolve`
  methods as part of the frozen service contract. The packet now preserves the
  versioned `append/rebuildIndex` contract and documents the concrete read API.

## Cannot Verify From Diff

- Full AC-32 lifecycle retention remains assigned to migration, report,
  release, and archive tasks.
- Evidence integrity and freshness remain Task 013.

## Acceptance Assertions Verified

- `AC-22`
- `AC-31`
- `AC-32:evidence-store-retention`

## Verified Behavior

- Storage matches the frozen parent design layout.
- Raw records are append-only and failed attempts survive later passes.
- Content objects are addressable by hash and safely published.
- Index rebuild is deterministic and validates source identity.
- Lookup blocks missing, invalid, or stale indexes without raw-scan fallback.
- Invalid non-JSON candidates return exact blockers without throwing.

## Required Fixes

- No further specification fix is required for the Task 012 append-only
  EvidenceStore boundary; integrity and verdict behavior remain downstream.
