# Task 020 Quality and Security Re-review: NOT APPROVED

## Blocking Finding

A signed, internally consistent rerun plan could expand `impacted_cases` and
`required_cases` together. Signature verification proved who produced the plan
but did not independently prove that its scope matched Task 022's authoritative
approved scope.

## Required Fix

- Require an independent rerun scope authority.
- Compare required, repaired, impacted, baseline, case-entry, and reason maps
  against the authoritative scope.
- Include the authoritative scope digest in Core transition proposals.
- Add an adversarial signed expanded-scope test.

## Disposition

Preserved as failed review evidence. A third independent quality and security
review is required after the fix.
