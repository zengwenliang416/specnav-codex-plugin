# Independent Quality Review: 016-six-domain-aggregation

## Verdict

blocked

## Findings

- Schema-valid Readings with invented evidence ids could produce PASS because
  aggregation did not resolve evidence records or integrity facts.
- Invented `not_applicable` facts could produce PASS without an explicit
  external approval validator.
- DecisionEngine trusted a caller-authored aggregate with empty source ids.
- `stale` or `canceled` terminal metadata could overwrite a real failed
  Reading at case and release aggregation.

## Required Repairs

- Require schema-valid evidence records, exact Reading/evidence identity, and
  intact fresh integrity facts before a Reading contributes.
- Require an explicit external `not_applicable` validator and reject the state
  when that authority is absent.
- Make DecisionEngine recompute aggregation from the source request.
- Preserve `fail` above `stale` and `canceled` in the terminal-state lattice.
- Add focused negative tests for every reproduced false-green path.

## Evidence

The reviewer reproduced every finding locally while the original positive
suite remained green. Receipts `247` and `248` contain the post-repair focused
and no-light system executions.
