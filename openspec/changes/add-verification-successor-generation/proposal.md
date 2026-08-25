## Why

Verification 2.0 currently evaluates every persisted run, attempt, reading,
evidence record, and non-closed failure as one lifetime Gate. When immutable
historical run artifacts are unrecoverable and the affected failures have been
legally routed to `break_loop`, a later clean verification cannot produce a
machine-green Gate without deleting or rewriting history.

Historical incidents must remain immutable and visible, but they must not
permanently prevent a separately approved successor verification generation
from proving the current snapshot.

## What Changes

- Add a human-approved, append-only successor verification generation
  authority.
- Bind each generation to the approved case snapshot, current execution
  fingerprints, exact historical `break_loop` failure ids, and a frozen
  baseline inventory of all pre-generation verification facts.
- Require every new run to bind the active generation id.
- Scope freshness, integrity, aggregation, failure state, Gate decisions, and
  report sources to the active generation.
- Preserve prior facts unchanged and disclose excluded historical incidents as
  report warnings.
- Reject baseline drift, execution before activation, unbound runs, forged
  approvals, manual green, fallback, and network-policy relaxation.

## Capabilities

### New Capabilities

- `verification-successor-generation`: an explicitly approved verification
  suffix can establish a new Gate while preserving immutable prior history.

### Modified Capabilities

- `verification-2-0`: production execution and finalization require an active
  generation and use only generation-bound facts as current Gate inputs.

## Impact

- Verification schemas, governance authority, production runner, artifact
  pipeline, host adapter, report warnings, focused tests, and Verification
  skill documentation.
- No product repository source, historical attempt/failure/reading/evidence,
  browser execution implementation, or Playwright network-policy changes.
