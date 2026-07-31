# Task 013 Collaborator Boundary RED Evidence

- Task: `013-evidence-integrity`
- Captured at: `2026-07-31`
- Command: `node --test tests/verification-v2/evidence/integrity.test.js`
- Exit status: `1`
- Result: `20` passed, `1` failed.
- Escaped error: `hostile validator result`

The checker caught a validator that threw during invocation, but did not
defensively snapshot and validate the returned result. A hostile or malformed
result object could therefore throw during later property access. The repair
must reject unreadable or malformed collaborator results with
`verification-contract:cross-reference-check-failed`.
