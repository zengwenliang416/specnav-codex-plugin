# Task Report: 014-evidence-redaction

## Status

DONE

## Delivered Slice

Reviewers can inspect logs, structured provider metadata, command output,
Markdown, JSON, and HTML projection without provider secrets leaking. The
redaction boundary runs before persistence and HTML escaping runs only after
redaction.

## Files Changed

- `plugins/specnav-verification/kernel/evidence/**`
- `plugins/specnav-verification/kernel/reporting/**`
- `plugins/specnav-verification/kernel/index.js`
- `tests/verification-v2/security/**`
- `tests/verification-v2/kernel/package-boundary.test.js`
- Task packet, validation log, ledger, drift record, and append-only evidence

## What Changed

- Added public `createSecretRedactor()` and `renderSafeHtmlText()` utilities
  without changing the frozen service contract digest.
- Centralized sensitive-key families for text and structured redaction.
- Added deterministic marker selection when a configured secret overlaps the
  default marker.
- Added recursive structured cloning and fail-closed handling for cycles,
  accessors, symbol keys, hostile Proxies, unsupported values, excessive depth,
  excessive node counts, unsafe field labels, and secret-bearing object keys.
- Added credential-aware text handling for headers, environment output, CLI
  flags, JSON, cookies, URL credentials, and sensitive query parameters.
- Canonicalized sensitive URL query markers to their encoded form.
- Added redaction metadata containing only status, field paths, and count.
- Added safe HTML projection that redacts before escaping and rejects forged
  redactor collaborators.

## TDD Evidence

- `169-014-evidence-redaction.log` preserves the missing-public-API RED run.
- `170-014-evidence-redaction.log` and its security review preserve raw JSON,
  authorization-scheme, structured-key, and metadata-path bypasses.
- `171-014-evidence-redaction.log` and its quality review preserve marker
  collision and duplicated-taxonomy defects.
- `172-014-evidence-redaction.log` preserves the prefixed query regression.
- `173-014-evidence-redaction.log` and its security review preserve configured
  secret query canonicalization failures.
- `174-014-evidence-redaction.log` records the final focused suite at 25/25.
- `175-014-evidence-redaction.log` records the full V2 suite at 292/292.
- `176` through `179` `.log` files record both plugin fixtures, runtime
  readiness, and static checks.

## Verification Commands

- `node --test tests/verification-v2/security/redaction.test.js tests/verification-v2/kernel/package-boundary.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `node plugins/specnav-verification/scripts/verification-runtime.js doctor --version 2.0.0-alpha.1 --project /Volumes/zwl/AI/ai-coding/specnav-codex-plugin --root /Users/wenliang_zeng/.specnav/runtime/verification --json`
- `for file in plugins/specnav-verification/kernel/evidence/*.js plugins/specnav-verification/kernel/reporting/*.js tests/verification-v2/security/*.js tests/verification-v2/kernel/package-boundary.test.js; do node --check "$file" || exit 1; done && git diff --check`

## Concerns

- Command, Playwright, and Midscene adapters still own capture integration.
- Full report models and pages remain Tasks 023 through 026.
- Runtime doctor reports the existing non-blocking Midscene provider warning;
  Task 011 remains blocked until real provider configuration exists.

## Scope Deviations

- The task packet was corrected to include public Kernel exports,
  package-boundary tests, the reporting projection owner, and lifecycle
  evidence required to deliver AC-30.
- The four CodeGraph runtime JSON files are intentionally excluded from this
  task's commit.

## Follow-up Needed

- Task 026 must compose these utilities into accessible report pages.
- Host adapters must pass captured data through this boundary before
  persistence.

## Adjudication

Independent quality and security reviews approved the final implementation.
The final specification review verifies the completed artifact chain before
the task checkbox and checkpoint commit are recorded.
