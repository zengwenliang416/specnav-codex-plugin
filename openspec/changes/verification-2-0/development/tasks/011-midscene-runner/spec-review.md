# Spec Review: 011-midscene-runner

## Verdict

approved

## Missing Requirements

- No implementation requirement is missing from the Task 011 adapter and
  oracle boundary.
- The task stop condition is satisfied by the system-executed
  `gpt-5.6-luna` run in `development/evidence/222-011-midscene-runner.log`.

## Extra Behavior

- No Reading, EvidenceStore, six-domain aggregation, report, release, or
  archive verdict ownership was introduced.

## Misunderstood Requirements

- Midscene is correctly treated as an interaction and observation source, not
  as a PASS oracle.

## Cannot Verify From Diff

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
- The approved Motion Cover provider completed a real `gpt-5.6-luna`
  interaction; the deterministic oracle independently observed `Ready` and
  passed `assertion-1`.
- Provider egress uses an exact-authority loopback relay, and Midscene-generated
  text logs are redacted before publication.

## Required Fixes

- No further specification fix is required for Task 011.
