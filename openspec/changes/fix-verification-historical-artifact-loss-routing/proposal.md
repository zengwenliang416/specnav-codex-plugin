## Why

The repair-loop CLI requires the original run and attempt integrity artifacts
before it can evaluate a classified failure. If those immutable artifacts were
created successfully but later lost, the Runtime fails closed before the Core
can route the incident to break-loop handling.

Reconstructing the missing artifacts, inferring evidence integrity from a
classification envelope, or manually closing the failure would rewrite or
overstate historical facts.

## What Changes

- Add a human-approved, append-only `historical_artifact_loss` authority fact.
- Bind the fact to one signed classification envelope, recovery audit, failure,
  run, case, and attempt.
- Permit the repair-loop state machine to emit only a Core-owned
  `route_break_loop` proposal for that authority fact.
- Keep the failure open until the approved transition is separately applied.
- Add fail-closed tests for forged reviews, recovered artifacts, mismatched
  classification authority, and any attempt to treat artifact loss as green.

## Capabilities

### New Capabilities

- `verification-historical-artifact-loss-routing`: irrecoverable historical
  artifact loss can be represented without reconstructing evidence or
  deadlocking before Core break-loop routing.

### Modified Capabilities

- None.

## Impact

- Verification Runtime authority, schema, repair-loop CLI/state machine, host
  adapter, focused tests, and Verification skill documentation.
- No product repository, historical attempt/failure/reading/evidence, Runtime
  browser execution, or Playwright network-policy changes.
