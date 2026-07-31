# Task 010 Approved Browser Contract RED

Command:

```text
node --test tests/verification-v2/browser/playwright-adapter.test.js
```

Observed before the production fix:

- The Playwright test-case schema required only `scenario_id` and
  `browser_project`; it did not require `scenario_hash` or `allowed_origins`.
- A scenario could navigate to `file:` or an unapproved loopback HTTP origin,
  catch the navigation result, record a passing assertion, and finish with
  `status: passed`.

Expected:

- Approved Playwright contracts bind the exact serialized scenario SHA-256.
- Approved Playwright contracts bind an exact non-empty HTTP/HTTPS origin list.
- Source, attempt, or origin mismatches block before attempt creation.
- Browser access policy violations remain blocking even when scenario code
  catches the navigation error and records a passing assertion.

Result: RED, 14/16 tests passed and 2 failed.
