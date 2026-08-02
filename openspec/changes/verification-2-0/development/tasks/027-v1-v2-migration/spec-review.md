# Spec Review: 027-v1-v2-migration

## Verdict

approved

## Missing Requirements

- No Task 027 requirement is missing.

## Extra Behavior

- The implementation rejects SQL/database artifacts, duplicate sources,
  traversal, symlinks, migration-output recursion, pre-existing targets, forged
  receipts, and tampered rollback projections.
- Apply and rollback include compensating recovery for final receipt-write
  failure.

## Misunderstood Requirements

- No Task 027 requirement was misunderstood.

## Cannot Verify From Diff

- Cross-host installation, drift CI, release, and archive behavior remain
  downstream Tasks 028-033 and are not Task 027 omissions.

## Acceptance Assertions Verified

- AC-32: Original failed V1 bytes, failure verdict, actual result, backup, and
  historical receipts remain retained.
- AC-33: Dry-run, exact backup, transformed projection, validation result,
  receipt, rollback instructions, provenance checks, and compensation are
  directly implemented and tested.
- AC-34: Legacy green without intact and fresh evidence becomes blocked and
  requires rerun; only the real Evidence Integrity path can retain PASS.

## Required Fixes

- No required fix remains.

## Re-review

- approved
- Final authoritative evidence is `396-399`: focused migration/package
  boundary, full Verification `491/491`, plugin/no-light contracts, and
  syntax/diff validation.
