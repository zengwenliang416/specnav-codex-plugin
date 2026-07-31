# Quality Review: 008-runtime-doctor

## Verdict

approved

## Separation Of Concerns

- `plugins/specnav-verification/scripts/verification-runtime.js:60-118` keeps the
  CLI thin. `doctor` assembles explicit remediation commands and delegates the
  decision to `doctorRuntime()`. `repair` is routed to a separate
  `repairRuntime()` boundary rather than being folded into doctor logic.
- `plugins/specnav-verification/skills/specnav-verification-runtime-status/SKILL.md:10-30`
  remains read-only and still forbids install, repair side effects during
  doctor, runtime switching, `npx`, global packages, system browsers, and
  global Playwright caches.
- `plugins/specnav-verification/kernel/runtime/doctor.js:38-65` extracts action
  synthesis and blocked-result assembly into `addAction()` and
  `blockedResult()`. This closes the earlier quality defect where remediation
  was inconsistent across early-return branches.

## Component Cohesion / Coupling

- Reuse remains strong and localized. Doctor still consumes
  `resolveRuntimeLock()` from Task 006 and installer-derived runtime topology
  helpers from Task 007 instead of cloning lock semantics or browser layout.
- The new repair boundary in
  `plugins/specnav-verification/kernel/runtime/repair.js:21-89` is cohesive:
  it owns preserve-then-replace behavior, while actual installation remains
  delegated to `installRuntime()`.
- Coupling is lower than in the prior review because blocked action generation
  is now centralized. `doctorRuntime()` is still a long function, but the
  earlier inconsistency came from duplicated return paths; that specific issue
  is now removed.

## Test Quality

- The prior coverage gap is closed. Focused tests now cover:
  ready runtime, secret redaction, optional versus required Midscene provider
  config, missing runtime install action, corrupt lock remediation, incompatible
  environment remediation, tampered lock or missing browser or unloadable
  package blockers, permission and receipt identity failures, installed-runtime
  corruption repair action, and repair rollback semantics.
- The new action-contract and repair-boundary checks are exercised in
  `tests/verification-v2/runtime/doctor.test.js:266-307` and
  `tests/verification-v2/runtime/doctor.test.js:380-447`.
- System receipts `032`, `033`, and `034` prove the wrapper, focused suite, and
  syntax checks were actually executed after the fix,
  `openspec/changes/verification-2-0/development/validation-log.jsonl:60-62`.
- Earlier RED provenance is still preserved by `027`. I did not rely on a
  separate `031` file because none is present in the current evidence
  directory.

## Error Handling

- The two prior Required Fixes are closed.
- First, blocked doctor results now return explicit remediation actions across
  the previously missing classes:
  `verification-runtime:plugin-repair-required` for corrupt lock or Kernel
  identity repair,
  `verification-runtime:environment-repair-required` for unsupported Node or
  platform,
  `verification-runtime:install-supported-version` for unsupported requested
  version,
  `verification-runtime:install-required` for absent managed runtime, and
  `verification-runtime:repair-required` for installed-runtime corruption,
  `plugins/specnav-verification/kernel/runtime/doctor.js:217-275` and
  `plugins/specnav-verification/kernel/runtime/doctor.js:523-532`.
- Second, the action contract is now tested directly rather than inferred from
  the success path alone,
  `tests/verification-v2/runtime/doctor.test.js:266-307` and
  `tests/verification-v2/runtime/doctor.test.js:380-405`.
- Secret handling remains correct. `probeProvider()` still exposes only presence
  booleans and credential variable names, and the ready-path test still proves
  that model names, base URLs, and API keys are absent from serialized output,
  `plugins/specnav-verification/kernel/runtime/doctor.js:128-165` and
  `tests/verification-v2/runtime/doctor.test.js:177-210`.
- No silent fallback was introduced. Doctor and repair both return
  `fallback_used: false`, and the CLI surfaces explicit remediation commands
  instead of selecting another runtime or environment path,
  `plugins/specnav-verification/scripts/verification-runtime.js:117-118` and
  `plugins/specnav-verification/kernel/runtime/repair.js:77-82`.

## Reuse / Duplication

- The implementation still reuses the runtime lock, installer receipt contract,
  and installer-driven path conventions rather than creating a second source of
  truth.
- The previous duplication of blocked-result assembly has been reduced to one
  helper plus targeted action injection. This is a quality improvement, not a
  new duplication hotspot.

## Complexity Delta

- Complexity increased slightly because the doctor now synthesizes five distinct
  remediation classes and because repair adds a preserve-then-restore
  transactional path.
- That increase is proportionate to the defect fixed. The new code removes the
  earlier inconsistent remediation behavior without collapsing doctor and repair
  into one routine.
- The repair boundary is acceptable as implemented: prior runtime is renamed to
  a timestamped preserved directory before replacement, and a failed replacement
  restores the prior runtime when the new target does not exist,
  `plugins/specnav-verification/kernel/runtime/repair.js:53-58` and
  `plugins/specnav-verification/kernel/runtime/repair.js:83-87`.

## Required Fixes

- No further quality fix is required for Task 008 after remediation synthesis
  and preserve-then-restore repair behavior were independently exercised.

## Direct Evidence

- `development/evidence/027-008-runtime-doctor-red.log`
- `development/evidence/032-008-runtime-doctor.log`
- `development/evidence/033-008-runtime-doctor.log`
- `development/evidence/034-008-runtime-doctor.log`
