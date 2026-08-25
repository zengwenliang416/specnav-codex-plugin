# Verification

## Approval

- Runtime repair review:
  `runtime-repair-review-historical-artifact-loss-routing-20260825`
- Review canonical SHA-256:
  `6af1fa68c8b2b4f3b094a37eb0e903031b97e64dbbb5865d8150533772e3be95`
- Scope SHA-256:
  `fc9f044423a2f9aa6b6a7952e43be89d4b33881cf4edff67e139ff7f43dce863`
- Reviewer: `wenliang_zeng`
- Reviewed at: `2026-08-25T08:50:23Z`

## Automated Checks

- `node --test tests/verification-v2/repair-loop/*.test.js tests/verification-v2/contracts/*.test.js`
  - 200 passed, 0 failed.
- `node --test tests/verification-v2/cross-host/codex-adapter.test.js tests/verification-v2/cross-host/drift-detector.test.js tests/verification-v2/production/host-adapter-routing.test.js`
  - 36 passed, 0 failed.
- `openspec validate fix-verification-historical-artifact-loss-routing --strict`
  - Valid, no issues.
- Installed Codex Adapter `describe --json`
  - Exposes `repair-artifact-loss-record`.
  - Reports `approval_required: true`.
  - Reports `fallback_supported: false` and
    `manual_green_supported: false`.
- `git diff --check`
  - Passed.

## Real Project Exercise

The repaired Runtime was installed into the local Codex SpecNav Verification
surface and exercised against:

- Project:
  `/private/tmp/camera-rental-dispatch-verification-final`
- Change: `add-xianyu-dispatch-backfill`
- Approved snapshot:
  `snapshot-e2974027eb42390762a49dcb`
- Snapshot SHA-256:
  `e2974027eb42390762a49dcb28ad4201b9b42784cf2e001204591c621d153969`
- Recovery audit:
  `openspec/changes/add-xianyu-dispatch-backfill/verify/historical-artifact-recovery.md`
- Recovery audit SHA-256:
  `130b3a8ee0cf1170c77090fc9414908805af614e0d24f032d6f5058e8c6c668a`

For all 14 open failures:

- A human-approved review bound the original signed classification envelope,
  exact run/case/attempt identity, recovery audit bytes, and four missing
  run/attempt authority paths.
- `repair-artifact-loss-record --approved` returned
  `historical_artifact_loss_recorded` with `replayed: false`.
- `repair-evaluate` returned `break_loop_required`.
- Every proposal action was `route_break_loop` with `owner: core`.
- Every authority claimed `artifact-loss:no-integrity-claim`.
- No `repair-transition-apply` command was executed.

After evaluation:

- `failure-state.json` still listed 14 open failures.
- No `route_break_loop` transition receipt existed.
- Existing `attempt-facts.jsonl` remained byte-unchanged.
- Historical attempts, failures, readings, evidence, and run artifacts were
  not reconstructed or modified.
- Product source was unchanged.
- The project artifacts were committed locally as `ecfcc251` and were not
  pushed.

## Network Safety

The installed Runtime and versioned source copies of these files were
byte-identical after installation and real-project exercise:

- `kernel/execution/browser-access-policy.js`
  - SHA-256:
    `56f2c95a545509d2f40c5baa86bfd6a3f0ff2b66dd7868edc060ccfc8dffc40b`
- `kernel/execution/playwright-api-guard.js`
  - SHA-256:
    `b8a31aa1ee0fd94bcabc7ac5aa876cd58789cb33fad72ce4024c67885df1320f`
- `kernel/execution/playwright-worker.js`
  - SHA-256:
    `d3bf4bc25d9fdb815654f49827a477b1b88a3ecad3e41da1ddbe26d36b2582f9`

No Playwright network or browser execution policy was relaxed.

## Gate Status

This change does not make the camera-rental Verification green. The 14
failures remain open until each Core-owned `route_break_loop` proposal is
separately approved and applied. The route records an unrecoverable historical
incident; it does not assert evidence integrity, test success, or closure.

The broader Runtime smoke/release suite still has pre-existing baseline
failures unrelated to this change:

- CASE-03 smoke expected-file inventory omits
  `run-verification-runtime-scope.sh`.
- The `cross-host-lock` schema does not yet accept the existing `dsh` host.
- Release host-artifact checks fail as a consequence.

Those failures reproduce on the unmodified `8b059e9` baseline and have no file
overlap with this repair.
