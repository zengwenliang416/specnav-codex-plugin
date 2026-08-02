# Initial Quality and Security Review: 028-codex-integration

## Verdict

needs-fix

## Findings

- A child result with `fallback_used: true` was hidden by a top-level
  `fallback_used: false`.
- `migrate-apply` and `migrate-rollback` could mutate project artifacts without
  explicit adapter approval.
- Route validation used source-text checks instead of executing the router.

## Required Fixes

- Fail closed when a child does not explicitly attest
  `fallback_used: false`, and expose any forbidden fallback signal.
- Require explicit approval for migration apply and rollback.
- Execute the real Codex route in the focused integration fixture.
