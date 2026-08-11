# Spec Review: 017-not-applicable-approval

## Verdict

approved

## Missing Requirements

- No requirement is missing from the narrowed Task 017 slice.

## Extra Behavior

- No report renderer, repair loop, host adapter, fallback, simplified
  verification path, or business-project dependency mutation was added.

## Misunderstood Requirements

- Task 017 directly closes `AC-20`.
- Task 017 contributes the validated `not_applicable` branch to `AC-19`;
  Task 016 retains complete six-domain terminal-result ownership.

## Cannot Verify From Diff

- Complete release/archive proof remains Task 033.
- Cross-host parity remains Tasks 028 through 031.

## Acceptance Assertions Verified

- AC-20

## Downstream Contribution

The task contributes policy-valid `not_applicable` terminal facts consumed by
the downstream six-domain aggregation work, but does not claim that downstream
assertion as verified here.

## Verified Behavior

- Reason, evidence ids, reviewer, approval timestamp, and policy reference are
  schema-required.
- The expected reviewer must be human and match the configured identity.
- Policy scope, effective time, update time, and expiration fail closed.
- Evidence must be schema-valid, intact, fresh, captured before approval, and
  bound to the same change, case, domain, assertion, and owning step.
- Fact identity binds current case, policy, and evidence content digests.
- The six-domain aggregator consumes only a fact revalidated by this authority.

## Required Fixes

- No further specification fix is required for Task 017.
