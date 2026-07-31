# Task Report: 008-runtime-doctor

## Status

DONE

## Files Changed

- `plugins/specnav-verification/kernel/runtime/doctor.js`
- `plugins/specnav-verification/kernel/runtime/repair.js`
- `plugins/specnav-verification/scripts/verification-runtime.js`
- `plugins/specnav-verification/skills/specnav-verification-runtime-status/SKILL.md`
- `tests/verification-v2/runtime/doctor.test.js`
- `tests/run-verification-runtime-doctor.sh`
- Task lifecycle evidence and review artifacts.

## What Changed

- Added a read-only runtime doctor that resolves exactly one locked runtime and
  reports package, package-lock, browser, permission, receipt, platform, Node,
  and Kernel identity facts.
- Added exact blocker and action output for missing, corrupt, incompatible,
  unloadable, non-executable, or unprobeable runtime artifacts.
- Added an explicit repair command that preserves the prior runtime, installs a
  fresh locked replacement transactionally, and restores the prior runtime if
  replacement fails.
- Added a redacted Midscene provider probe. It reports only field presence and
  credential source names, never model names, URLs, API keys, or init JSON.
- Added `doctor` to the managed-runtime CLI and documented the corresponding
  status skill. Doctor never installs, repairs, selects another version, or
  uses global packages, `npx`, system browsers, or global Playwright caches.

## TDD Evidence

- RED `027`: the focused test failed because
  `kernel/runtime/doctor.js` did not exist.
- Focused tests cover a ready runtime, optional versus required Midscene
  configuration, absent runtime actions, corrupt locks, missing browsers,
  unloadable packages, permissions, receipt identity mismatches, remediation
  actions, and repair rollback.
- The CLI fixture probes the real managed runtime at
  `~/.specnav/runtime/verification/2.0.0-alpha.1`, including both locked browser
  executables and all five packages.

## Verification Commands

- `bash tests/run-verification-runtime-doctor.sh`
- `node --test tests/verification-v2/runtime/doctor.test.js`
- `node --check plugins/specnav-verification/kernel/runtime/doctor.js && node --check plugins/specnav-verification/scripts/verification-runtime.js`

## Concerns

- Runtime `2.0.0-alpha.1` remains intentionally limited to `darwin-arm64`.
- Midscene provider configuration is optional for generic readiness and becomes
  an exact blocker only when the selected approved case requires Midscene.

## Scope Deviations

- None recorded.

## Follow-up Needed

- Task 003 must use only the doctor-approved managed AJV runtime.
- Tasks 010 and 011 must consume doctor output during execution preflight.
- Tasks 013, 016, and 033 retain ownership of `AC-28` release/archive gate
  behavior. The incorrect `AC-28` binding was removed from this doctor-only
  task packet after independent spec review.

## Adjudication

- Provider values are redacted by construction and are not copied into status
  output, logs, or report inputs.
- `fallback_used` is always `false`; missing readiness facts block the required
  execution surface instead of selecting another runtime.
