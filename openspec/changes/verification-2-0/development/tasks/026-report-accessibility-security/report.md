# Task Report: 026-report-accessibility-security

## Status

DONE

## Delivered Slice

Stakeholders can use all three standalone report pages on desktop and mobile,
operate their navigation and filters by keyboard, inspect semantic tables and
status text, print the authoritative facts, and review hostile artifacts
without executable markup or exposed credentials.

## Files Changed

- Shared report shell, CSP helper, catalog/results renderer, and report CSS
- Cross-page browser accessibility and print suite
- Report security, redaction, contrast, and gate-independence suite
- Unified report browser runner
- Task packet, screenshots, validation log, and evidence

## What Changed

- Added a default-deny standalone-page CSP. The report shell accepts only the
  closed `catalog-filter` script identity. Script source and the approved
  SHA-256 digest live in separate asset/contract files, and runtime pin mismatch
  fails closed. Pages without scripts declare `script-src 'none'`.
- Removed inline event handlers and kept catalog filtering inside one static,
  hash-bound script.
- Escaped shell titles, added post-shell fail-closed checks to the case
  and overview renderers, rejected active raw body content, pinned the exact
  stylesheet digest, and preserved the renderer blocker contract for shell
  failures.
- Added a keyboard-focusable skip target, semantic reading-table caption and
  header scopes, visible focus proof, and real paginated PDF assertions that
  retain exact verdict, case, evidence, and blocker facts.
- Adjusted green and amber status tokens so every text/status token meets the
  4.5:1 contrast threshold on both report surfaces.
- Added hostile dynamic-field, configured-secret, credential-shape, and
  manually-edited-HTML tests. The DecisionEngine-independence test edits an
  emitted HTML file and proves the kernel decision result remains derived from
  its original JSON request. Final release/archive gate-entry proof remains
  Task 033.
- Added a real Chromium negative test proving an injected script is blocked
  while the approved catalog filter continues to operate.
- Browser artifacts are written to a unique run-id directory, refuse an
  existing destination, and emit a manifest containing run id, generation
  time, command id, source commit, source-patch digest, artifact type, verdict,
  page, viewport/page count, Tagged/JavaScript PDF facts, path, size, and
  SHA-256 digest.

## TDD Evidence

- `349` preserves the initial RED run for missing CSP and report accessibility
  closure.
- `350-351` preserve intermediate test-harness failures while the production
  CSP and security behavior already passed.
- `352-356` preserve the first green implementation before independent review.
  Review found that its CSP authorization and print/screenshot oracles were
  insufficient; those receipts remain append-only but do not close the task.
- `357-361` preserve the second implementation, but their claimed timestamps
  were later than their system-executed timestamps. Adjudication retains and
  overturns those receipts instead of rewriting history.
- `362-366` preserve the third implementation. Third-round review required a
  resolver-level pin-mismatch assertion and corrected browser-only receipt
  wording, so adjudication retains and overturns these receipts.
- `367` records the final browser-only Chromium suite at 5/5. It binds six
  desktop/mobile PNG files and six green/blocked paginated PDFs to
  `026-report-artifacts/20260802T114819Z-41354/manifest.json`, whose SHA-256 is
  `a26112db4cae1a35e341e8d5de9828eabfd40b242bae50de2d15ec4d3b69f9ab`.
  Every PDF is Tagged, contains no PDF JavaScript, reports a positive page
  count, and preserves its required verdict/case/evidence/blocker text.
- `368` records the final focused security suite at 5/5, including direct
  resolver-level rejection of changed script source against the fixed pin.
- `369` records the complete Verification 2.0 suite at 472/472.
- `370` records Verification, Development, and no-light plugin contracts.
- `371` records syntax and diff validation.
- `374-026-report-accessibility-security-adjudication-contract-red.md`
  preserves the lifecycle-contract RED proving that stale green receipts could
  not yet be superseded without rewriting history.
- `372-374` preserve the first lifecycle replay whose claims were timestamped
  after their system-executed receipts; they remain append-only and are
  superseded by `375-377`.
- `375` proves append-only adjudication correction fixtures, `376` proves all
  plugin and no-light contracts, and `377` proves lifecycle closure with 37
  legitimate downstream unfinished-work blockers.
- `378-379` preserve the final specification and quality/security approvals for
  the corrected lifecycle contract.
- `378-026-report-accessibility-security.log` and
  `379-026-report-accessibility-security.log` re-prove the final Development
  and cross-plugin contracts after review fixes; `380` re-proves lifecycle
  closure with 37 legitimate downstream unfinished-work blockers.

## Verification Commands

- `bash tests/run-verification-v2-report-browser.sh`
- `node --test tests/verification-v2/security/report-security.test.js`
- `node --test tests/verification-v2/**/*.test.js`
- `bash tests/run-verification-plugin-fixtures.sh`
- `bash tests/run-development-plugin-fixtures.sh`
- `bash tests/run-verification-v2-no-light.sh`
- Syntax checks for report and security JavaScript plus `git diff --check`

## Concerns

- No unresolved Task 026 concern remains. Inline styles are required for the
  self-contained report artifact and remain isolated by `default-src 'none'`;
  executable content is selected only by the closed, independently pinned
  script registry.

## Scope Deviations

- The required browser runner was missing from the generated allowed-file list.
  The task packet was corrected before implementation to include only
  `tests/run-verification-v2-report-browser.sh`.
- Lifecycle closure exposed that the shared Development contract only allowed
  failed receipts to be overturned. A separate contract-maintenance change now
  permits an exact stale PASS or failed receipt to be superseded only by a
  later same-task system-executed PASS, while a later valid adjudication can
  repair an earlier incomplete adjudication without rewriting history.

## Follow-up Needed

- Task 027 owns V1/V2 migration. Task 033 owns final six-domain release and
  archive proof.

## Adjudication

The initial and intermediate failing runs, first green receipts, and independent
review findings remain append-only. The timestamp-invalid `357-361` receipts
and review-superseded `362-366` receipts are explicitly overturned; `367-371`
supersede them without overwriting history. Task 026 proves that HTML edits
cannot alter the DecisionEngine input or result. Task 033 remains responsible
for proving the downstream release/archive gate entrypoints never consume HTML
as authority. Fresh specification and quality/security reviews approved the
final worktree with no required fixes. The first lifecycle receipts `372-374`
also remain immutable and are superseded by chronology-valid receipts
`375-377`. The final lifecycle-contract re-review rejected latest-only
semantics, confirmed duplicate evidence identities fail closed, and approved
the digest-bound correction chain.
