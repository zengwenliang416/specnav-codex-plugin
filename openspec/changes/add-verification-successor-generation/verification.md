# Verification

## Automated Checks

- `openspec validate add-verification-successor-generation --strict`
  - Valid, no issues.
- Production tests excluding the unrelated
  `case-03-smoke-routing.test.js` baseline:
  - 43 passed, 0 failed.
- Contract, evaluation, and report tests:
  - 195 passed, 0 failed.
- Focused report and schema tests:
  - 46 passed, 0 failed.
- Focused successor-generation authority and schema tests:
  - 11 passed, 0 failed.
- Focused host-artifact tests:
  - 4 passed, 0 failed.
- Final focused generation, runner, and schema rerun:
  - 34 passed, 0 failed.
- Final focused report and host-artifact rerun:
  - 29 passed, 0 failed.
- `bash tests/run-verification-runtime-scope.sh`
  - 14 passed, 0 failed.
- `bash tests/run-verification-v2-release.sh`
  - Support tests: 37 passed, 0 failed.
  - Sharded release proof: 43 passed, 0 failed.
  - Final result:
    `verification v2 release and archive proof ok`.
- `node --check` for every modified JavaScript file:
  - Passed.
- `jq empty` for every modified or added JSON file:
  - Passed.
- `git diff --check`
  - Passed.

## Successor Generation Coverage

The focused and release suites prove:

- activation requires the exact reviewed artifact and explicit approval;
- snapshot, fingerprint, frozen-baseline, or approval drift fails closed;
- execution is blocked without an active generation;
- new runs bind the active `generation_id`;
- retry, retest, and regression lineage cannot cross generations;
- only post-activation generation-bound facts enter the current Gate;
- historical `break_loop` failures remain immutable and appear as warnings;
- current-generation evidence, integrity, freshness, and failure defects block;
- fallback and manual-green paths remain unavailable.

## Network Safety

No diff exists in:

- `plugins/specnav-verification/kernel/execution/browser-access-policy.js`
- `plugins/specnav-verification/kernel/execution/playwright-api-guard.js`
- `plugins/specnav-verification/kernel/execution/playwright-worker.js`

The Playwright network safety boundary was not relaxed.

## Known Unrelated Baseline

`tests/verification-v2/production/case-03-smoke-routing.test.js` retains six
pre-existing failures because its expected script inventory omits the existing
`run-verification-runtime-scope.sh`. The successor-generation change does not
modify that test or script inventory.

## Remaining Real Project Gate

The Runtime has not yet been installed into the local Codex Verification
surface for this change. A real camera-rental generation review must be
prepared, approved by exact review id and SHA-256, activated, followed by all
eight approved case executions and an owning `finalize` result with `ok: true`.
