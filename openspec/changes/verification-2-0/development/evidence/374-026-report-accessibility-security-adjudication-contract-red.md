# Task 026 Append-Only Adjudication Contract RED

## Command

`bash tests/run-development-plugin-fixtures.sh`

## Observed Result

The new pass-supersession fixture exited `1` because the existing development
contract returned:

`validation-log:invalid-overturn-target:001-dashboard-summary`

## Meaning

The previous validator only allowed failed system-executed receipts to be
overturned. It could not preserve an independently invalidated green receipt
and later repair its incomplete adjudication without rewriting history.

## Required Repair

- Accept an exact system-executed PASS or FAIL target.
- Require a later system-executed PASS successor from the same task.
- Validate only the latest append-only adjudication for the same task and
  target, so a correction can repair an earlier incomplete adjudication.
- Keep unresolved or forged supersession blocked.
