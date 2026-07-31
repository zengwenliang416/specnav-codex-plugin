# Browser Policy RED Evidence

## Command

`node --test tests/verification-v2/browser/browser-access-policy.test.js`

## Result

Failed before production implementation with exit status `1`.

## Failure

Node could not resolve
`plugins/specnav-verification/kernel/execution/browser-access-policy.js`.

## Purpose

This preserves the focused RED state for exact approved-origin enforcement
before the browser access policy owner was added.
