# Task 010 Playwright API Guard RED

Probe:

```text
approved scenario -> page.context().unroute('**/*')
                  -> page.goto(unapproved loopback origin)
                  -> passing assertion
```

Observed before the fix:

```json
{
  "status": "passed",
  "blockers": []
}
```

The BrowserContext route policy existed, but the approved scenario still
received raw Playwright objects and could remove the policy or create a new
unguarded browser context.

Expected:

- Scenario code receives guarded Playwright capabilities.
- Policy route mutation, unguarded context creation, and CDP escape surfaces
  produce `verification-execution:playwright-access-denied`.
- Catching the denied API error and recording a passing assertion cannot
  convert the attempt into PASS.
