# Task 013 Hostile Proxy RED Evidence

- Task: `013-evidence-integrity`
- Captured at: `2026-07-31`
- Command: `node --test tests/verification-v2/evidence/integrity.test.js`
- Exit status: `1`
- Result: `14` passed, `1` failed.
- Failure: `hostile proxy input fails closed without escaping or reaching collaborators`
- Escaped error: `hostile length trap`

The failure proved that an array Proxy could pass the initial shape check and
throw when its `length` property was read later. The production fix must take a
defensive input snapshot before invoking collaborators or reading collection
state, and return `verification-integrity:request-invalid` when snapshotting
fails.
