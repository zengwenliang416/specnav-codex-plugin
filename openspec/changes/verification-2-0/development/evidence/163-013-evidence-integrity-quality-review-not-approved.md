# Task 013 Independent Quality Review

## Verdict

NOT APPROVED

## Blocking Findings

1. Inconsistent cross-reference collaborator results can produce false green:
   `{ok:false, blockers:[]}` and `{ok:true, blockers:[...]}` are not rejected.
2. Store metadata reads do not revalidate store-root containment after
   construction, so a replaced ancestor symlink can redirect `raw.jsonl` and
   `index.json` reads outside the change root.
3. Failed or unsafe object reads can report `exists`, `hash_match`, and
   `size_match` as true even though no trusted bytes were read.
4. Freshness regression tests do not independently mutate `test_sha` and
   `environment_hash`.

## Review Scope

- Evidence-integrity checker and evidence-store implementation.
- Evidence-integrity and package-boundary tests.
- False-green, exception, mutation, path, freshness, binding, blocker,
  ownership, and public-contract risks.
- The four CodeGraph runtime side-effect files were excluded.

## Required Repair

- Reject internally inconsistent collaborator results and fail closed.
- Revalidate store-root containment for each metadata read and use no-follow
  descriptor reads.
- Derive positive object facts only from a successful object read.
- Cover all six execution-fingerprint fields independently.
