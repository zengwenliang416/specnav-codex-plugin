# Quality Review Evidence: 021-case-freshness

## Verdict

NOT APPROVED

## Blocking Findings

1. The shared comparator returned frozen arrays while legacy evidence freshness
   attempted to sort one of those arrays in place, causing a TypeError instead
   of a fail-closed result.
2. Latest-attempt selection considered case id and sequence but did not bind
   candidates to the selected run and change.
3. Run-level fingerprint values were sourced from the attempt, so a missing
   run fingerprint could be hidden by a populated attempt.

## Required Repair

- Preserve immutable comparator results without mutating them.
- Restrict latest-attempt selection to the active run and change.
- Treat run or attempt fingerprint absence as missing source evidence and keep
  run identity authoritative.
