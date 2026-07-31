# Spec Review: 011-midscene-runner

## Verdict

approved

## Missing Requirements

- No implementation requirement is missing from the Task 011 adapter and
  oracle boundary.
- A real provider-backed execution is still required by the task stop
  condition before lifecycle completion; this is an environment blocker, not
  an implementation omission.

## Extra Behavior

- No Reading, EvidenceStore, six-domain aggregation, report, release, or
  archive verdict ownership was introduced.

## Misunderstood Requirements

- Midscene is correctly treated as an interaction and observation source, not
  as a PASS oracle.

## Cannot Verify From Diff

- Live provider behavior cannot be verified because the strict runtime doctor
  reports `verification-runtime:midscene-provider-not-configured`.
- Downstream Reading and aggregate verdict behavior remains owned by Tasks 015
  and 016.

## Acceptance Assertions Verified

- `AC-16`
- `AC-39:midscene-adapter-boundary`

## Verified Behavior

- The adapter uses the managed runtime and sandboxed Playwright worker.
- Provider credentials remain confined to the worker environment, and doctor
  and adapter configuration identities must match.
- Model output alone cannot pass; deterministic or approved human evidence is
  required.
- Human signoff occurs after screenshot publication and cannot approve a
  screenshot that changes during review.
- The deterministic oracle receives a read-only Playwright surface.
- Missing provider configuration, screenshot evidence, oracle evidence,
  timeout, cancellation, and malformed worker output fail closed.
- The system retains all worker artifact and observation channels without
  fabricating evidence.

## Required Fixes

- No specification fix is required for the implementation.
- Do not mark Task 011 complete until the strict doctor passes and a real
  provider-backed scenario is retained as system-executed evidence.
