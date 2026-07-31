# Task Report: 010-playwright-runner

## Status

DONE

## Delivered Slice

Reviewer can execute an approved Playwright case through the managed runtime
and inspect deterministic assertion observations, trace, screenshot, video,
console, and network artifact candidates without allowing scenario code to
escape the approved browser or worker boundary.

## Files Changed

- `plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
- `plugins/specnav-verification/kernel/execution/browser-access-policy.js`
- `plugins/specnav-verification/kernel/execution/playwright-api-guard.js`
- `plugins/specnav-verification/kernel/execution/playwright-scenario.js`
- `plugins/specnav-verification/kernel/execution/playwright-worker.js`
- Shared execution preflight, orchestrator, lifecycle, runtime, schema, and
  kernel export files allowed by the task packet
- `tests/verification-v2/browser/**`
- Focused runner, runtime, schema, and cross-reference fixtures
- Task packet, validation log, ledger, drift record, and append-only evidence

## What Changed

- Added a managed-runtime Playwright adapter with approved scenario, browser,
  source, request, attempt, and exact-origin identity checks.
- Added isolated worker execution with private staging and atomic artifact
  publication.
- Added browser evidence capture for deterministic assertions, trace,
  screenshot, video, console, and network observations.
- Added exact HTTP/HTTPS origin enforcement for requests, WebSocket access,
  popups, and browser events.
- Added a capability membrane that denies route removal, unguarded browser
  contexts, CDP, private fields, constructor/prototype reflection, raw callback
  receivers, and raw Page/Context values returned through events or bindings.
- Added host process confinement for filesystem reads/writes, direct network
  access, and detached child processes.
- Added parent-generated IPC nonce authentication so scenario code cannot forge
  lifecycle events or terminal results.
- Preserved first-stop-cause semantics for timeout and cancellation.
- Kept all output below the Reading/EvidenceStore/verdict boundary.

## TDD Evidence

- `128-010-playwright-runner-browser-policy-red.md` records the original
  browser-network-policy gap.
- `129-010-playwright-runner-approved-browser-contract-red.md` records the
  missing approved-origin contract.
- `133-010-playwright-runner-api-guard-red.md` records the API escape surface.
- `134-010-playwright-runner-quality-review-api-escape.md` and
  `135-010-playwright-runner-quality-review-ipc-forgery.md` preserve the final
  independent security findings that drove the capability membrane and IPC
  authentication repairs.
- `133-010-playwright-runner.log` records the final focused suite at 22/22.
- `134-010-playwright-runner.log` records the final full suite at 218/218.
- `135` through `138` record both plugin fixtures, runtime doctor, and static
  checks after the nonce repair.

## Verification Commands

- `node --test tests/verification-v2/browser/browser-access-policy.test.js tests/verification-v2/browser/playwright-adapter.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `node plugins/specnav-verification/scripts/verification-runtime.js doctor --version 2.0.0-alpha.1 --project /Volumes/zwl/AI/ai-coding/specnav-codex-plugin --root /Users/wenliang_zeng/.specnav/runtime/verification --json`
- `for file in plugins/specnav-verification/kernel/adapters/playwright-adapter.js plugins/specnav-verification/kernel/execution/*.js plugins/specnav-verification/kernel/runtime/*.js tests/verification-v2/browser/*.js; do node --check "$file" || exit 1; done`
- `git diff --check`

## Concerns

- Browser scenarios are intentionally treated as untrusted code and receive a
  constrained Playwright API surface. New Playwright APIs must be explicitly
  reviewed before exposure.
- Raw artifact candidates are not persistent evidence until Task 012 stores
  them and Task 013 verifies integrity.

## Scope Deviations

- None recorded.

## Follow-up Needed

- Task 011 adds Midscene interaction under a separate deterministic-oracle
  boundary.
- Tasks 012, 013, and 015 own persistence, integrity, and readings.

## Adjudication

Independent specification and quality reviews approved the final live
worktree. Task 010 is complete.
