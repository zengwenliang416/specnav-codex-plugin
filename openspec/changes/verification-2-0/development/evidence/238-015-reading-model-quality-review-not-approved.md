# Quality Review Evidence: 015-reading-model

## Verdict

not approved

## Blocking Findings

1. `identityValid()` did not bind `case_snapshot_hash`, `environment_hash`,
   `runtime_version`, or `kernel_version` between the attempt and run. An
   attempt from a different execution context could therefore produce PASS.
2. When every candidate Reading failed schema validation, the evaluator
   replaced the exact `verification-reading:schema-invalid` blocker with the
   generic `verification-reading:request-invalid` /
   `required-readings-empty` result.

## Required Repair

- Bind every run-owned attempt fingerprint before Reading creation.
- Preserve exact schema blockers when no valid Reading survives.
- Add regression tests for both paths and rerun focused and full validation.
