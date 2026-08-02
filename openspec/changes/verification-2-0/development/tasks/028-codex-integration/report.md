# Task Report: 028-codex-integration

## Status

DONE

## Delivered Slice

Codex users can discover one full Verification 2.0 entrypoint, inspect the
shared Kernel contract, run verification and runtime actions, receive exact
blockers and artifact paths, and cannot request fallback, manual green, or a
partial-domain lane.

## Files Changed

- Codex adapter and entry skill under `plugins/specnav-verification/`.
- Codex plugin metadata and stage contract.
- Core verification routing and Codex-formatted bootstrap next actions.
- Shared verification CLI no-fallback attestations.
- Focused Codex cross-host tests and executable runner.
- Task lifecycle, RED evidence, reviews, and system-executed receipts.

## What Changed

- Added `codex-verification-adapter.js` as a thin host adapter. It exposes
  shared Kernel identity, all six domains, skills, actions, and report paths.
- Routed verification intent to `$specnav-verification` instead of bypassing
  runtime and full-gate checks through the plan skill.
- Added an entry skill that sequences runtime readiness, approved cases, all
  six domains, repair/retest/regression, machine validation, and reports.
- Delegated validate, aggregate, report, runtime, rerun, and V1/V2 verification
  artifact conversion actions to existing shared scripts with argument arrays
  and no shell interpolation.
- Required explicit approval for runtime mutation and state-changing
  verification artifact conversion.
- Required every child command to attest `fallback_used: false`; missing or
  true fallback state blocks and is surfaced rather than normalized away.
- Preserved shared Kernel ownership. The adapter does not implement Reading,
  six-domain aggregation, DecisionEngine, release verdict, or report-model
  semantics.

## TDD Evidence

- `406` preserves the initial RED failure because the Codex adapter did not
  exist.
- `408` preserves the initial quality/security findings.
- `409` preserves three review-driven RED tests for fallback and verification
  artifact conversion approval defects.
- `410` is the final focused receipt: Codex adapter tests pass `9/9`.
- `411` is the final full receipt: Verification 2.0 passes `500/500`.
- `412` proves Codex plugin, marketplace, skill, hook, route, Verification,
  Development, and no-light contracts.
- `413` proves syntax and scoped diff validation.
- `414-028-codex-integration.log` proves lifecycle closure with only the 31
  legitimate downstream blockers for Tasks 029-033.

## Verification Commands

- `bash tests/run-verification-v2-codex.sh`
- `node --test $(find tests/verification-v2 -type f -name '*.test.js' | sort)`
- Codex plugin, marketplace, skill, hook, and route fixture runners.
- Verification, Development, and no-light contract runners.
- Node syntax checks and `git diff --check`.

## Concerns

- No unresolved Task 028 implementation concern remains.
- Claude Code, CodeFree-O, cross-host drift CI, documentation, and release
  proof remain owned by Tasks 029 through 033.

## Scope Deviations

- The task packet did not explicitly name shared source-CLI fallback
  attestations, but they were required to make the Codex no-fallback boundary
  independently verifiable.
- No host-neutral Kernel logic was added or duplicated.

## Follow-up Needed

- Task 029 must consume the same adapter contract through Claude Code.
- Task 030 must consume it through CodeFree-O.
- Task 031 must compare all host contracts and Kernel identities.

## Adjudication

The initial quality/security review remains append-only. Its fallback
suppression, mutation approval, and route-test findings were reproduced,
repaired, and re-reviewed. Final system-executed receipts supersede the earlier
pre-review green run.
