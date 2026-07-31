# Task Report: 001-baseline-fake-green

## Status

DONE

## Files Changed

- `tests/run-verification-v2-baseline.sh`
- `tests/run-verification-plugin-fixtures.sh`
- `plugins/specnav-development/scripts/development-contract.js`
- `plugins/specnav-verification/scripts/evidence-runner.js`
- `tests/verification-v2/baseline/run.sh`
- `tests/verification-v2/baseline/cases.json`
- `tests/verification-v2/baseline/evidence-runner-append-only.test.js`
- `tests/verification-v2/baseline/README.md`
- `docs/verification-v2-gap-analysis.md`
- Task 001 packet, validation ledger, and drift record under this change.

## What Changed

- Added thirteen executable counterexamples that V1 currently aggregates to green
  but Verification 2.0 must block.
- Added red and blocked-domain rendering baselines for AC-29.
- Covered missing acceptance, empty evidence, missing files, hash mismatch,
  size mismatch, stale code SHA, unknown producers, broken case/step
  references, missing runtime artifacts, manual green, mtime-only freshness,
  and unverified HTML.
- Extracted a stable source-only mode from the V1 fixture builder and repaired
  its missing Git HEAD so the same clean fixture can support both suites.
- Every negative case now copies a complete passing control and injects one
  defect, preventing later V2 gates from blocking for an unrelated defect.
- The HTML-source case removes structured readings before V1 still renders a
  green report, and both red/blocked report cases assert that the required V2
  overview, catalog, and results pages are absent.
- Evidence runner receipts now use monotonically increasing filenames across
  reruns, so later validation cannot overwrite earlier command evidence.
- Development review parsing now accepts the hyphenated acceptance ids used by
  this change, so citations such as `AC-17` are machine-verifiable.
- Lifecycle packet, validation, review, drift, ledger, and checkbox files are
  task-control artifacts, not production validator behavior.

## TDD Evidence

- `bash tests/run-verification-v2-baseline.sh` reproduced all thirteen
  fake-green states and both report-state baselines before any V2 production
  fix.
- Each case records `observed_v1: green` and `expected_v2: blocked`.
- Each fake-green observation records the `required_blocker` that later V2
  tasks must assert.
- Report-state observations also consume `report-center:pages-missing`.
- `evidence-runner-append-only.test.js` executes two runs and proves that the
  first log remains byte-for-byte unchanged.
- The baseline remains committed as a regression corpus for later tasks.

## Verification Commands

- `node --test tests/verification-v2/baseline/*.test.js`
  - system-executed exit status: 0
  - result: append-only evidence log regression passed
- `bash tests/run-verification-plugin-fixtures.sh`
  - system-executed exit status: 0
  - result: `specnav verification plugin fixtures ok`
- `bash tests/run-verification-v2-baseline.sh`
  - system-executed exit status: 0
  - result: `verification v2 baseline reproduced: 13 fake-green cases, 2 report states`
- `npm test`
  - system-executed exit status: 0
  - result: existing Codex/SpecNav smoke fixtures remained green
- Evidence logs:
  - New review receipts use unique monotonically increasing files under
    `development/evidence/`.
  - The superseded initial receipts are retained and explicitly overturned
    after their original log paths were found to have been reused.

## Concerns

- The baseline intentionally depends on the current V1 fixture library API. If
  that builder changes, this task must be reviewed to confirm the thirteen gaps are
  still reproduced rather than silently skipped.
- These fake-green cases are not fixed yet. Later tasks must convert them to exact V2
  blocker assertions without deleting the baseline.

## Scope Deviations

- The shared fixture and lifecycle-control artifact paths were added to the
  task packet because extraction, independent review, system evidence, and
  checkbox completion necessarily write those files.

## Follow-up Needed

- Task 002 must establish the shared kernel and explicit adapter/service
  boundary before contract implementations begin.
- Tasks 003, 004, 012, 013, 021, and 023 must progressively turn these
  observations into direct blocker assertions.

## Adjudication

No product decision is required. The baseline is approved only as evidence of
the current gap, not as acceptable release behavior.
