# Task Report: 027-v1-v2-migration

## Status

DONE

## Delivered Slice

Maintainers can explicitly dry-run, apply, validate, and roll back V1
verification artifact migration without overwriting V1 history or converting
unverified legacy green state into V2 PASS.

## Files Changed

- Host-neutral migration Kernel owners under
  `plugins/specnav-verification/kernel/migration/`
- Public Kernel export and thin `verification-migrate.js` CLI
- Focused migration, CLI, package-boundary, failure-injection, and security
  tests
- Executable focused runner and task lifecycle evidence

## What Changed

- Added one explicit `createV1ToV2Migrator` API. Migration never runs as a
  lifecycle side effect.
- Dry-run reads and validates every declared V1 source but performs zero
  writes.
- Apply preserves each source byte-for-byte, writes an immutable backup
  manifest, emits a separate V2 reading projection, validates every nested V2
  reading and the migration receipt, and refuses existing targets.
- Legacy `pass` or `green` remains PASS only when the real Evidence Integrity
  Checker returns `ok`, `intact`, and `fresh`. Missing, stale, broken, or
  malformed evidence produces `blocked`,
  `verification-migration:legacy-pass-unverified`, and `requires_rerun: true`.
- Legacy `fail` or `red` retains its failure verdict, actual value, source
  digest, original bytes, and exact backup.
- SQL, declared database artifacts, duplicate sources, traversal, unsafe
  change roots, symlinks, migration-output recursion, and existing targets
  fail closed.
- Rollback accepts only the canonical receipt, backup manifest, reading
  projection, and identities for the requested migration. Forged in-root
  references cannot delete unrelated files.
- Apply compensates receipt-write failure by removing all partial outputs.
  Rollback compensates receipt-write failure by restoring the exact projection
  bytes before returning a blocker.
- Final file reads and writes use no-follow file descriptors, exclusive
  creation, parent containment checks, and fsync. V1 source files are never
  deleted or overwritten.
- Backup and migrated-reading envelopes are internal versioned transport
  artifacts, not unregistered schema claims. Their structure is checked by the
  migration owner; nested readings and receipts use the registered V2 schema
  system.
- The CLI constructs the real Evidence Store, Cross-reference Validator, and
  Evidence Integrity Checker for dry-run/apply. Rollback uses only the
  validated immutable receipt and does not require unrelated integrity
  configuration.

## TDD Evidence

- `381` preserves the RED baseline: 15 expected failures because the Kernel
  factory and CLI did not exist.
- `382-389` preserve the first green implementation and system-executed
  evidence before independent review.
- `390` preserves the initial specification review and its documentation /
  lifecycle closeout requirements.
- `391` preserves the initial quality/security review, including forged
  receipt, partial transaction, transport-envelope, no-follow, rollback CLI,
  and live-checker findings.
- `392-395` preserve the repaired direct focused, full, contract, and syntax
  runs.
- `396` is the final system-executed focused receipt: 19 migration/CLI tests
  and 4 package-boundary tests pass.
- `397` is the final system-executed Verification 2.0 suite: `491/491`.
- `398` proves Verification, Development, and no-light contracts.
- `399` proves syntax and scoped diff validation.
- `400-027-v1-v2-migration.log` proves the corrected Development SQL-intent
  fixture contract.
- `401-027-v1-v2-migration.log` re-proves Verification, Development, and
  no-light plugin contracts after the lifecycle fix.
- `402-027-v1-v2-migration.log` proves lifecycle closure with exactly 34
  legitimate downstream unfinished-work blockers.
- `403-405` are the final authoritative replay after restricting migration
  intent discovery to requirements, plans, handoff, traceability, and task
  review artifacts rather than append-only history logs.
- `400-027-v1-v2-migration-spec-review-approved.md` and
  `401-027-v1-v2-migration-quality-review-approved.md` preserve the final
  independent approvals.

## Verification Commands

- `bash tests/run-verification-v2-migration.sh`
- `node --test $(find tests/verification-v2 -type f -name '*.test.js' | sort)`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `bash tests/run-verification-v2-no-light.sh`
- Node syntax checks for every migration owner and CLI
- `git diff --check` excluding immutable raw evidence logs and CodeGraph JSON

## Concerns

- No unresolved Task 027 concern remains. Cross-host installation and release
  enforcement remain owned by Tasks 028-033.

## Scope Deviations

- The generated packet omitted the Kernel public export, package-boundary
  assertion, and focused runner. The packet was corrected before production
  implementation without changing migration ownership.

## Follow-up Needed

- Task 028 integrates the shared Kernel with Codex.
- Tasks 029 and 030 integrate the same Kernel with Claude Code and CodeFree-O.
- Task 031 proves cross-host drift detection.
- Task 033 owns final release and archive proof.

## Adjudication

The RED baseline, first green implementation, and both initial independent
reviews remain append-only. Final receipts `396-405` supersede the pre-review
green evidence after all required quality/security and lifecycle-contract
fixes. No fallback, Verification light mode, manual green override, V1
overwrite, or database migration path was introduced.
