# Task 012 EvidenceStore Spec Review: NOT APPROVED

Date: 2026-07-31

Verdict: NOT APPROVED

## Blocking Findings

1. The task packet described `append`, `rebuildIndex`, `getById`, and `resolve`
   as one service contract, while the frozen Kernel contract exposes only
   `append` and `rebuildIndex`. The contract digest must not change without an
   explicit API version upgrade.
2. The implementation used `raw/evidence.jsonl`,
   `objects/sha256/<prefix>/<hash>`, and
   `indexes/evidence-index.json`, which disagreed with the parent design's
   frozen `raw.jsonl`, `objects/<content-hash>.<ext>`, and `index.json`
   layout.
3. `getById()` scanned raw JSONL instead of validating and using the summary
   index. Missing or stale indexes therefore did not produce explicit
   blockers.
4. `structuredClone()` could throw for non-JSON candidates such as functions,
   BigInt values, circular references, or non-plain objects instead of
   returning `verification-evidence:candidate-invalid`.

This failed review is retained append-only. A later approval must not replace
or delete it.
