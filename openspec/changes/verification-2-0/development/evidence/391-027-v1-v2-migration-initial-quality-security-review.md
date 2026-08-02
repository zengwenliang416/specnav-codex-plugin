# Initial Quality and Security Review: 027-v1-v2-migration

## Verdict

needs-fix

## Findings

- High: rollback accepted schema-valid receipts whose artifact references were
  not bound to the requested migration's canonical receipt, backup, and run
  paths.
- High: apply and rollback could leave partial state if final receipt creation
  failed.
- Medium: transport envelopes used schema-like names without registered schema
  validation.
- Medium: path checks used path-based reads and writes after separate symlink
  checks.
- Low: rollback CLI unnecessarily required Evidence Integrity configuration.
- Test gaps covered forged receipt deletion, apply compensation, rollback
  compensation, and a live CLI Evidence Integrity path.

## Required Fixes

- Bind rollback provenance to exact migration-owned paths and identities.
- Add compensating cleanup/restore semantics for interrupted writes.
- Treat backup/projection envelopes as internal versioned artifacts while
  validating their nested V2 readings and migration receipt through the
  registered schema system.
- Use no-follow file descriptors for final file reads and writes.
- Construct Evidence Integrity services only for dry-run and apply.
- Add direct negative and live-integration tests.

## Adjudication

All findings require a fresh focused, full, contract, syntax, specification,
and quality/security replay. This review is not an approval.
