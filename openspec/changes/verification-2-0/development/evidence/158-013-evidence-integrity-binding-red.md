# Task 013 Binding Integrity RED Evidence

- Task: `013-evidence-integrity`
- Captured at: `2026-07-31`
- Command: `node --test tests/verification-v2/evidence/integrity.test.js`
- Exit status: `1`
- Result: `19` passed, `1` failed.
- Failure: a cross-reference binding mismatch returned
  `binding_match:false` while the same evidence fact still reported
  `integrity:intact`.

Binding is part of the evidence-integrity contract. A failed binding must make
the evidence fact and summary integrity `broken` while preserving the exact
cross-reference blocker.
