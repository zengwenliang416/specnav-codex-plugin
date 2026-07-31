# Task 013 Object Ancestor Race RED Evidence

- Task: `013-evidence-integrity`
- Captured at: `2026-07-31`
- Command:
  `node --test tests/verification-v2/evidence/integrity.test.js`
- Exit status: `1`
- Result: `27` passed, `1` failed.

## Reproduced Failure

The test allowed `EvidenceStore.resolve()` to complete, then replaced the
`objects/` ancestor directory with an external symlink containing a file with
the exact expected bytes. The existing object reader followed the replaced
ancestor, trusted the external bytes, and returned overall `ok:true`.

The repair must bind the object descriptor read to a revalidated store root and
ancestor path, not only to the leaf filename.
