# Task 013 Independent Security Review

## Verdict

NOT APPROVED

## Blocking Finding

`checkIntegrity()` validates an object path through `EvidenceStore.resolve()`
and later reopens that path in `readEvidenceObject()`. The object reader uses
`O_NOFOLLOW` for the leaf but does not revalidate the store root and ancestor
directories around the descriptor open.

An attacker can therefore replace `objects/` with an external symlink after
`resolve()` succeeds and before the object reader opens the file. If the
external file has the expected bytes, the current implementation can report
`exists`, `hash_match`, `size_match`, and `path_safe` as true.

## Missing Regression Test

The existing tests cover leaf object symlinks, a replaced store root, unsafe
injected paths, and collaborator failures. They do not cover the exact
`resolve()`-then-ancestor-swap race.

## Required Repair

- Revalidate store-root containment and every object-path ancestor before and
  after opening the descriptor.
- Keep `O_NOFOLLOW` on the leaf.
- Verify the opened descriptor still identifies the path validated after open.
- Add a regression test that swaps `objects/` after `resolve()` succeeds.
