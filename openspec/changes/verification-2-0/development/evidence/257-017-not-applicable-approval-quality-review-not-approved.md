# Independent Quality And Security Review: 017-not-applicable-approval

## Verdict

not approved

## Recorded At

2026-08-01T04:30:27Z

## Blocking Findings

1. Not-applicable evidence was bound only to `change_id`, `case_id`, and
   `domain`. Evidence from another step or assertion in the same case/domain
   could therefore authorize the decision.
2. The validated fact contained only evidence ids. Reusing an evidence id with
   different path, hash, size, or producer content did not invalidate the old
   fact.
3. Policy timestamps used permissive `Date.parse()` checks. Timestamp strings
   without an explicit timezone were accepted and could produce host-dependent
   decisions.

## Required Repairs

- Require every evidence assertion to belong to the selected domain assignment
  and require its step to own that assertion.
- Bind the approval fact to stable canonical evidence identity digests.
- Reject policy timestamps that are not explicit RFC3339 timestamps with `Z`
  or a numeric offset.
- Add focused negative tests for all reproduced defects.

## Review Evidence

- Existing focused suites passed before review.
- Read-only reproductions demonstrated cross-assertion evidence acceptance,
  same-id evidence content drift acceptance, and timezone-less policy approval.
- No files were modified by the reviewer.
