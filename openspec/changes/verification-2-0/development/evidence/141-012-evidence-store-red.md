# Task 012 EvidenceStore RED

Recorded at: 2026-07-31T17:42:00Z

Command:

```text
node --test tests/verification-v2/evidence/evidence-store.test.js
```

Observed result:

```text
FAIL
Error: Cannot find module '../../../plugins/specnav-verification/kernel/evidence'
tests: 1
pass: 0
fail: 1
exit code: 1
```

This is the expected pre-implementation failure. The test existed before the
EvidenceStore module.
