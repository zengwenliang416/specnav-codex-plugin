# Development Review

Read this before closing a task or handing off to verification.

## Spec Review

Check for:

- missing requirements;
- extra behavior;
- misunderstood requirements;
- behavior that cannot be verified from the diff;
- required fixes.

## Quality Review

Check for:

- separation of concerns;
- component cohesion and coupling;
- test quality;
- error handling;
- reuse and duplication;
- complexity delta.

## Handoff Rule

Do not hand off to six-domain verification until every task has a report, spec
review, quality review, ledger entries, validation log, and drift check.
