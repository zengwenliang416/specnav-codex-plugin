# Task Report: 020-retest-regression-loop

## Status

COMPLETE

## Files Changed

- `plugins/specnav-verification/kernel/repair/repair-loop-state-machine.js`
- `plugins/specnav-verification/kernel/repair/index.js`
- `plugins/specnav-verification/kernel/index.js`
- `plugins/specnav-verification/kernel/contracts/schema-registry.js`
- `plugins/specnav-verification/schemas/trusted-fact-envelope.schema.json`
- `plugins/specnav-verification/schemas/transition-proposal.schema.json`
- `tests/verification-v2/repair-loop/state-machine.test.js`
- `tests/verification-v2/contracts/**`
- `tests/verification-v2/kernel/package-boundary.test.js`
- `tests/run-verification-v2-repair-loop.sh`
- Task 020 lifecycle and review artifacts under
  `openspec/changes/verification-2-0/development/**`

## What Changed

- Added a host-neutral repair-loop state machine that preserves immutable
  failure, retry, repair, retest, and regression history.
- Added deterministic `FLAKY` and `PASS AFTER FIX` labels.
- Added Core-owned request, close, reopen, and break-loop transition proposals;
  the Kernel never executes lifecycle transitions.
- Added signed trusted-fact envelopes for classification, repair, attempt
  evidence, and rerun plans.
- Added an independent Task 022 rerun scope authority and bound its digest into
  regression transition proposals.
- Reused Task 004 retry identity validation and rejected foreign run/change,
  unplanned regression, stale/tampered pass, caller transition, fallback, and
  manual-green inputs.

## TDD Evidence

- Initial API RED:
  `development/evidence/295-020-retest-regression-loop.log`
- Failed specification review:
  `development/evidence/300-020-retest-regression-loop-spec-review-not-approved.md`
- Failed quality/security reviews:
  `development/evidence/301-020-retest-regression-loop-quality-review-not-approved.md`
  and
  `development/evidence/302-020-retest-regression-loop-quality-review-not-approved.md`
- Approved independent reviews:
  `development/evidence/303-020-retest-regression-loop-spec-review-approved.md`
  and
  `development/evidence/304-020-retest-regression-loop-quality-review-approved.md`
- Final focused GREEN:
  `development/evidence/300-020-retest-regression-loop.log`

## Verification Commands

- `bash tests/run-verification-v2-repair-loop.sh`: 23/23 passed.
- `node --test tests/verification-v2/**/*.test.js`: 420/420 passed.
- `bash tests/run-verification-plugin-fixtures.sh && bash tests/run-development-plugin-fixtures.sh`: passed.
- `git diff --check -- . ':(exclude)openspec/changes/verification-2-0/development/evidence/*.log' ':(exclude)openspec/changes/verification-2-0/codegraph/*.json'`: passed.

## Concerns

None. Host integrations must supply the required trust verifier and Task 022
scope authority; Tasks 028-030 own those adapters.

## Scope Deviations

The original task packet was corrected to include public Kernel exports,
versioned schemas, contract fixtures, lifecycle evidence, and central
acceptance ownership surfaces. No host integration was implemented.

## Follow-up Needed

- Task 023 consumes immutable repair-loop history in the shared report model.
- Tasks 028-030 provide host-specific trust and scope authority adapters.
- Core continues to own actual close, reopen, and break-loop transitions.

## Adjudication

The initial missing-API RED is preserved and superseded by the final focused
GREEN. Both failed independent reviews are preserved and superseded by fresh
approved reviews after their reproduced blockers were fixed.
