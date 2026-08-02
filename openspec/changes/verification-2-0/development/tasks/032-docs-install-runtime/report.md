# Task Report: 032-docs-install-runtime

## Status

DONE

## Files Changed

- `README.md`
- `README.zh-CN.md`
- `docs/verification-2-0.md`
- `docs/verification-2-0.zh-CN.md`
- `tests/verification-v2/docs/documentation.test.js`
- `tests/run-readme-contract.sh`
- `tests/run-verification-v2-docs.sh`

## What Changed

- Added matched English and Chinese Verification 2.0 guidance covering the
  mandatory six-domain flow, case approval, runtime installation and doctor,
  Playwright and Midscene boundaries, evidence authority, repair/retest/
  regression, reports, migration, host installation, blockers, and archive.
- Updated both README files to route users into the same full Verification 2.0
  lifecycle without light, compact, partial-domain, fallback, or manual-green
  language.
- Added executable documentation contracts that keep both languages and the
  README entry points aligned.

## TDD Evidence

- `455-032-docs-install-runtime.log` preserves the initial 0/3 RED: the README
  lacked the Verification 2.0 route and both detailed guides were absent.
- `462-032-docs-install-runtime.log` passes the final documentation contract
  at 3/3.
- `463-032-docs-install-runtime.log` passes the README contract at 1/1.

## Verification Commands

- `bash tests/run-verification-v2-docs.sh`
- `bash tests/run-readme-contract.sh`

## Concerns

- Host-specific installation commands differ by repository, but the
  Verification 2.0 semantics, blocker policy, and report paths are shared.

## Scope Deviations

- The generated packet omitted both executable documentation runners and their
  focused test path. `scope-correction.json` records the bounded additive scope.

## Follow-up Needed

- Task 033 consumes these installation and operator guidance contracts for the
  final clean-install, release, and archive proof.

## Adjudication

Receipt `455` remains append-only and is explicitly overturned by `462`; `463`
separately proves the README entry contract.
