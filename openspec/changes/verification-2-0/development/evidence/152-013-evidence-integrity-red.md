# Task 013 RED Evidence

- Task: `013-evidence-integrity`
- Captured at: `2026-07-31`
- Command: `node --test tests/verification-v2/evidence/integrity.test.js`
- Exit status: `1`
- Result: `14` tests failed before production implementation.
- Primary failure: `Task 013 RED: checkIntegrity API is unavailable`

The failing suite established the required public contract before implementation:

- `createEvidenceIntegrityChecker()` must return `checkIntegrity(input)`.
- Results must contain integrity and freshness facts plus blockers only.
- Missing, tampered, stale, incorrectly bound, empty, and unsafe evidence must fail closed.
- The checker must not create Reading, release, archive, or manual green verdicts.

This RED record is append-only and must not be replaced by later passing evidence.
