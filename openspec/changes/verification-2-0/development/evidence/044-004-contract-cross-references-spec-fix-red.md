# Task 004 Spec Fix RED

Recorded at: `2026-07-31T08:54:57Z`

Command:

```text
node --test tests/verification-v2/contracts/cross-reference.test.js
```

Result:

- exit status: `1`
- tests: `104`
- passed: `91`
- failed: `13`
- suites: `0`
- cancelled: `0`
- skipped: `0`

The run preserved the existing green behavior and reproduced twelve intended
failing repair assertions plus the parent aggregation failure:

1. Browser attempts were not bound to the case runner's `browser_project`.
2. Duplicate case step ids were accepted.
3. Duplicate case assertion ids were accepted.
4. Missing step assertion references were accepted.
5. Missing assertion references were accepted in each of the six domains.
6. Reading step/assertion relationship mismatches were accepted.
7. Evidence step/assertion relationship mismatches were accepted.

The command completed in `1213.694667 ms`. This receipt is preserved as the
RED baseline for the Task 004 specification repair and must not be replaced by
the later green run.
