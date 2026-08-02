# Task Report: 029-claude-code-integration

## Status

DONE

## Files Changed

- `plugins/specnav-verification/**`
- `integrations/claude-code/sync-verification-plugin.js`
- `tests/verification-v2/cross-host/**`
- `tests/run-verification-v2-claude-adapter.sh`
- Claude Code plugin synchronization targets and Task 029 lifecycle evidence.

## Delivered Slice

Claude Code discovers `/specnav-verification`, executes the installed
downstream Claude adapter, consumes the same host-neutral Verification Kernel
as Codex, preserves exact blockers and artifacts, and cannot request a light,
fallback, partial-domain, or manual-green lane.

## What Changed

- Extracted host-neutral invocation and result projection into
  `host-verification-adapter.js`; Codex and Claude wrappers now inject host
  identity only.
- Added a Claude Code synchronizer that validates the exact downstream
  marketplace and plugin identity before writes.
- Removed the dirty-worktree override. A dirty downstream checkout is always a
  hard stop.
- Changed synchronization to build and validate a complete staging tree before
  same-filesystem replacement. A failed build leaves the installed plugin
  unchanged and removes staging artifacts.
- Added exact-copy, transformed-skill, and host-generated provenance. Every
  host entry records its target SHA-256.
- Updated the Claude plugin route, command, stage manifest, runtime repair
  guidance, Kernel payload, schemas, assets, skills, and provenance.
- The focused runner now launches the downstream
  `scripts/claude-verification-adapter.js` for `describe`, no-light rejection,
  and a full `validate` call against the Claude fixture project.

## TDD Evidence

- `416` preserves the initial RED failure before the Claude adapter existed.
- `417` and `418` preserve the pre-review green state.
- Initial independent reviews identified missing downstream execution proof,
  packet scope drift, unsafe target writes, dirty override behavior,
  non-transactional sync, and incomplete host provenance.
- `419` is the final focused receipt: `12/12` Claude adapter and synchronizer
  tests pass.
- `420` is the full Verification 2.0 receipt: `512/512` tests pass.
- `421` proves Claude smoke, Verification, Development, and no-light
  contracts.
- `422` proves syntax and diff validation.

## Verification Commands

- `bash tests/run-verification-v2-claude-adapter.sh`
- `node --test $(find tests/verification-v2 -type f -name '*.test.js' | sort)`
- `bash /Volumes/zwl/AI/ai-coding/specnav-claude-plugin/tests/run-smoke.sh`
- Verification, Development, and no-light contract runners.
- Node syntax checks and `git diff --check`.

## Concerns

- None remain for Task 029.

## Scope Deviations

- The generated packet omitted the shared host adapter extraction, existing
  Codex wrapper update, host-aware runtime guidance, and executable focused
  runner required to satisfy AC-40 without duplication.
- `scope-correction.json`, `context.json`, and `brief.md` record the corrected
  bounded file set and preserve Kernel ownership.

## Follow-up Needed

- Task 030 must integrate CodeFree-O through the same Kernel contract.
- Task 031 must make cross-host drift detection release-blocking.

## Adjudication

Initial review findings remain append-only. Final independent specification
and quality/security reviews approved the repaired implementation with no
remaining required fix.
