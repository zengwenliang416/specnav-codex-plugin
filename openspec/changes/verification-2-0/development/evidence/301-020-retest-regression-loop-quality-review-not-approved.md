# Task 020 Quality and Security Review: NOT APPROVED

## Blocking Findings

1. Frozen or shape-valid caller objects were accepted as trusted classifier,
   repair, attempt-fact, and rerun inputs.
2. A caller-authored rerun plan could remove baseline or impacted cases.
3. Retest and regression attempts were not bound to the failure packet's run
   and change identities.

## Required Fixes

- Require versioned trusted-fact envelopes with producer identity, payload
  digest, issuance time, failure/change/run/case bindings, claims, and a
  signature verified by an explicit trust verifier.
- Require verified review, evidence-integrity, and rerun-policy claims.
- Bind every attempt to the active failure run and change.
- Reject unplanned regression attempts and tampered envelopes.
- Add adversarial tests for all reproduced bypasses.

## Disposition

Preserved as failed review evidence. A fresh independent quality and security
review is required after the fixes.
