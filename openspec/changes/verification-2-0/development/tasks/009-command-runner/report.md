# Task Report: 009-command-runner

## Status

DONE

## Delivered Slice

Reviewer can execute approved command-backed cases and inspect structured
attempts, immutable execution identity, raw logs, ordered lifecycle events,
exit evidence, and exact blockers.

## Files Changed

- `plugins/specnav-verification/kernel/adapters/command-adapter.js`
- `plugins/specnav-verification/kernel/execution/**`
- `plugins/specnav-verification/kernel/index.js`
- `plugins/specnav-verification/schemas/test-case.schema.json`
- `tests/verification-v2/execution/**`
- Command-runner contract fixtures
- Task packet, validation log, ledger, drift record, and append-only evidence

## What Changed

- Added shell-free exact argv/cwd/env execution with stdout/stderr capture,
  timeout, cancellation, signals, nonzero exits, spawn failures, and bounded
  `SIGTERM` to `SIGKILL` escalation.
- Added pre-spawn gates for approved case snapshot, managed runtime readiness,
  schema-valid run identity, approved command contract, canonical cwd
  containment, and retry/cross-reference identity.
- Added running and terminal run/attempt lifecycle objects plus immutable,
  monotonically sequenced events.
- Preserved the first successful stop reason across timeout, abort, exit, and
  close races.
- Preserved raw output, ordered events, original execution blockers, and prior
  attempts through post-execution contract failures.
- Added schema-valid blocked terminal artifacts when possible.
- When every terminal artifact is rejected, returned `run: null` and
  `attempt: null` while preserving running history and emitting explicit
  `artifact_valid: false` terminal events.
- Cloned caller-owned attempt history before freezing returned results.
- Exported the command adapter and execution orchestrator from the public
  Verification Kernel entry.

## Acceptance

- Task 009 directly closes `AC-14`.
- Persistent evidence objects remain Task 012.
- Evidence integrity and derived green verdicts remain Tasks 013 and 016.
- Playwright and Midscene execution remain Tasks 010 and 011.

## TDD Evidence

- `066` preserves the original RED baseline.
- `072`, `079`, `085`, `091`, and `097` preserve independent quality-review
  failures.
- `073`, `079`, `085`, `091`, and `097` preserve review-driven RED behavior.
- `098` proves the deterministic timeout-before-abort test passes five isolated
  reruns.
- `099` records the final focused suite: 29/29 passed.
- `100` records the final full Verification V2 suite: 195/195 passed.
- `101` and `102` record both plugin fixture suites passing.
- `103` records syntax and diff checks passing.

## Verification Commands

- `for i in 1 2 3 4 5; do node --test --test-name-pattern="timeout remains the terminal cause when abort arrives before close" tests/verification-v2/execution/command-adapter.test.js || exit 1; done`
- `node --test tests/verification-v2/execution/command-adapter.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `for file in plugins/specnav-verification/kernel/adapters/command-adapter.js plugins/specnav-verification/kernel/execution/*.js tests/verification-v2/execution/*.js; do node --check "$file" || exit 1; done`
- `git diff --check`

## Concerns

- Raw logs remain in-memory execution output. Persistence, hashing, indexing,
  and redaction are intentionally deferred to Tasks 012 through 014.
- Approved cwd must exist and resolve before spawn; missing or inaccessible cwd
  fails closed.

## Scope Deviations

- The task required repeated race-condition repairs after independent review,
  but the delivered scope remained limited to the `AC-14` command execution
  boundary.
- No EvidenceStore, Reading, six-domain, report, host, release, or fallback
  behavior was added.

## Follow-up Needed

- Tasks 012 through 016 must persist, validate, interpret, and aggregate the raw
  execution output before it can influence a verification verdict.
- Task 020 must consume the immutable retry identity when implementing retest
  and regression closure.

## Adjudication

Independent specification and quality reviews both approved the final live
worktree. Task 009 is complete.
