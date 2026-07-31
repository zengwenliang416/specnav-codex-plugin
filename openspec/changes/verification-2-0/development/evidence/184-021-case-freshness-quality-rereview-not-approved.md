# Quality Re-review Evidence: 021-case-freshness

## Verdict

NOT APPROVED

## Blocking Finding

Missing run and attempt identity fields could compare as equal when both sides
were undefined. A selected attempt without a stable id could also produce a
fresh case fact whose attempt id was absent.

## Required Repair

- Validate run and snapshot identity before attempt selection.
- Require stable attempt id, run id, and change id for case candidates.
- Never treat missing identity fields as an equality match.
