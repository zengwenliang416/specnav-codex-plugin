# Independent Quality And Security Review: 018-failure-classification

## Verdict

not approved

## Recorded At

2026-08-01T05:29:39Z

## Blocking Findings

1. `failed_assertion_ids` accepted assertion ids unrelated to the classified
   readings.
2. The supplied evidence records, integrity facts, and integrity summary were
   not required to match the exact evidence-id set referenced by the readings.
   Extra records and incorrect evidence counts were accepted.
3. The packet id omitted `created_at` and `frozen_at`, so two packets with the
   same id could carry different timestamp content.

## Verified Behavior

- Trusted root-cause catalogs are cloned and frozen at construction.
- Six classification policies and the downstream Task 019/020 boundaries are
  explicit.
- Current focused tests pass, but they do not cover the reproduced defects.

## Required Repairs

- Add negative tests for assertion injection, extra/miscounted evidence and
  integrity facts, and same-id timestamp collisions.
- Make packet identity cover every mutable packet field or otherwise provide a
  distinct content digest that prevents same-id different-content packets.
