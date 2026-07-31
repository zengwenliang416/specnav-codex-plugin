# Independent Quality Review: 012-evidence-store

Recorded at: 2026-07-31T17:55:00Z

Verdict: `not approved`

Blocking findings:

1. A symlinked `changeRoot` was accepted and allowed the store to write into
   the symlink target outside the approved lexical change tree.
2. Index publication completed before cache publication; a cache failure could
   return blocked while leaving the new index visible.
3. Raw JSONL append assumed one `writeSync` call wrote the full line.
4. Several filesystem failures discarded the original error code and message,
   reducing diagnostic evidence.

The focused suite passed before review, but it did not cover these four failure
paths. This review remains preserved after repair.
