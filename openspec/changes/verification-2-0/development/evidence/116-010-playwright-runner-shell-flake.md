# Playwright Shell Runner Stability Failure

## Command

`bash tests/run-verification-v2-playwright.sh`

## Observed At

2026-07-31T15:18:32Z

## Result

FAILED: 13/14 tests passed.

## Failure

`Playwright assertion failure is terminal failed and retains artifacts` reached
the fixture's 30000ms timeout and returned
`verification-execution:playwright-timeout` instead of the expected
`verification-execution:playwright-assertion-failed`.

The preceding no-assertion case took 23605ms and the failed-assertion case
reached 31263ms while two independent reviewers were concurrently executing
the same real-browser suite. This proved that the fixture's 30-second
non-timeout budget did not provide sufficient cold-start and contention
headroom.

## Required Fix

Use a larger default budget for non-timeout real-browser fixtures while keeping
the explicit timeout and cancellation cases on their exact 30-50ms budgets.
