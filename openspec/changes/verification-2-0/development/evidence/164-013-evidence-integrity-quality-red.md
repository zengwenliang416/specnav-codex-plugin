# Task 013 Independent Quality Review RED Evidence

- Task: `013-evidence-integrity`
- Captured at: `2026-07-31`
- Verdict source:
  `163-013-evidence-integrity-quality-review-not-approved.md`

## Focused RED Runs

### Integrity checker

- Command:
  `node --test tests/verification-v2/evidence/integrity.test.js`
- Exit status: `1`
- Result: `24` passed, `3` failed.
- Confirmed failures:
  - Unsafe object reads emitted positive byte-trust facts.
  - `{ok:false, blockers:[]}` cross-reference results produced false green.
  - `{ok:true, blockers:[...]}` cross-reference results produced false green.

### Evidence store

- Command:
  `node --test tests/verification-v2/evidence/evidence-store.test.js`
- Exit status: `1`
- Result: `24` passed, `1` failed.
- Confirmed failure:
  - Replacing the store root with an external symlink allowed `getById()` to
    read external `raw.jsonl` and `index.json` metadata.

The complete six-field freshness table already passed after adding independent
`test_sha` and `environment_hash` mutations. This is coverage repair rather
than a production-code failure.
