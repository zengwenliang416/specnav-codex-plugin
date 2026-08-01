# Task Report: 011-midscene-runner

## Status

DONE

## Delivered Slice

Reviewer can execute an approved Midscene case through the managed runtime,
retain the interaction output and screenshot evidence, and obtain a terminal
result only from a separate deterministic oracle or approved human signoff.
Midscene model output cannot declare PASS.

## Files Changed

- `plugins/specnav-verification/kernel/adapters/midscene-adapter.js`
- `plugins/specnav-verification/kernel/execution/midscene-oracle.js`
- `plugins/specnav-verification/kernel/execution/midscene-prompt.js`
- `plugins/specnav-verification/kernel/runtime/provider-contract.js`
- Shared Playwright worker, API guard, orchestrator, preflight, runtime doctor,
  schema, and Kernel export files allowed by the task packet
- `tests/verification-v2/midscene/**`
- Focused runtime, package-boundary, plugin fixture, and contract runner files
- Task packet, validation log, ledger, and append-only evidence receipts

## What Changed

- Added a managed-runtime Midscene adapter that delegates browser work to the
  sandboxed Playwright worker instead of accepting a caller-owned raw Page.
- Added provider configuration fingerprinting shared by runtime doctor and the
  adapter. Callers cannot redirect execution to a different model provider at
  execute time.
- Added secret-safe prompt, model metadata, observation, log, and error
  projection.
- Added deterministic and human-signoff oracle modes. Human review starts only
  after screenshot evidence exists, and the screenshot hash is revalidated
  after the callback returns.
- Added a read-only Playwright capability membrane for deterministic oracles.
  Navigation, interaction, screenshots, evaluation, network mutation,
  keyboard, mouse, touchscreen, property mutation, prototype mutation, and
  reflective escape paths fail closed.
- Preserved complete artifact, assertion, console, and network channels from
  the worker result without granting Midscene verdict ownership.
- Added exact timeout, cancellation, malformed-result, missing-screenshot,
  provider-mismatch, and oracle-integrity blockers.

## TDD Evidence

- `development/evidence/205-011-midscene-runner-red.log` preserves the initial
  failing schema and adapter boundary tests.
- `development/evidence/206-011-midscene-runner-provider-blocked.log`
  preserves the real runtime blocker after the focused implementation tests
  passed.
- `development/evidence/207-011-midscene-runner.log` through
  `development/evidence/215-011-midscene-runner.log` contain the implementation
  and hardening passes.
- `development/evidence/216-011-midscene-runner.log` proves the final
  touchscreen and reflection hardening assertions with a system-executed
  1/1 pass.
- `development/evidence/217-011-midscene-runner.log` through
  `development/evidence/219-011-midscene-runner.log` are the checkpoint
  revalidation receipts: focused 31/31, full suite 353/353, both plugin
  fixtures, and diff checks passed.
- `development/evidence/222-011-midscene-runner.log` is the system-executed
  live provider receipt. It records `gpt-5.6-luna`, a passed deterministic
  oracle, one passed assertion, complete browser artifacts, and
  `fallback_used: false`.
- `development/evidence/run-midscene-live-20260801020207501-artifacts/proof.json`
  is the secret-free live proof. The same directory retains the screenshot,
  video, trace, console, network, assertions, and redacted Midscene logs.
- `development/evidence/223-011-midscene-runner.log` through
  `development/evidence/226-011-midscene-runner.log` are the completion
  revalidation receipts: focused 34/34, full suite 356/356, plugin and
  lifecycle fixtures, and diff checks all passed.
- `development/evidence/227-011-midscene-runner.log` preserves the obsolete
  maintenance expectation that Task 011 remained incomplete. Receipt `228`
  proves that blocker is retired, and receipt `229` proves the repaired full
  lifecycle contract with 59 legitimate downstream blockers remaining.
- `development/evidence/230-011-midscene-runner.log` and `231` prove the final
  private-staging cleanup hardening at focused 34/34 and full 356/356
  regression scope.

## Verification Commands

- `node --test tests/verification-v2/midscene/*.test.js tests/verification-v2/runtime/doctor.test.js`
- `node --test tests/verification-v2/browser/browser-access-policy.test.js tests/verification-v2/browser/playwright-adapter.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log'`
- `node plugins/specnav-verification/scripts/verification-runtime.js doctor --version 2.0.0-alpha.1 --project /Volumes/zwl/AI/ai-coding/specnav-codex-plugin --root /Users/wenliang_zeng/.specnav/runtime/verification --requires-midscene --json`
- `node tests/verification-v2/midscene/live-provider-run.js`

## Concerns

- Midscene internal logs are treated as untrusted text and are redacted before
  atomic publication. Binary screenshot, video, and trace artifacts are not
  rewritten.
- Provider egress is limited to a loopback CONNECT relay that accepts only the
  exact approved HTTPS authority.

## Scope Deviations

- None recorded.

## Follow-up Needed

- Task 015 consumes the resulting observation, deterministic oracle facts, and
  integrity-checked evidence to create verdict-bearing Readings.

## Adjudication

The implementation, live `gpt-5.6-luna` execution, deterministic oracle,
artifact set, secret scan, and final regressions are approved. Task 011 is
complete without fallback or a simplified verification path.
