# Spec Review: 008-runtime-doctor

## Verdict

approved

## Direct Review Scope

- Task packet and task context now bind this slice only to `AC-05`, not `AC-28`: [openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:65](openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:65), [openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/context.json:33](openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/context.json:33), [openspec/changes/verification-2-0/development/task-graph.json](openspec/changes/verification-2-0/development/task-graph.json), [openspec/changes/verification-2-0/development/task-context.jsonl](openspec/changes/verification-2-0/development/task-context.jsonl).
- Managed runtime spec still requires exact blocker reporting for missing packages or browsers, provider configuration status, filesystem permission, runtime version, kernel compatibility, and no fallback after doctor failure: [openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md:20](openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md:20), [openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md:24](openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md:24), [openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md:33](openspec/changes/verification-2-0/specs/managed-verification-runtime/spec.md:33).
- Acceptance target for this re-review is only `AC-05`: [openspec/changes/verification-2-0/acceptance.md:15](openspec/changes/verification-2-0/acceptance.md:15).

## Missing Requirements

- No blocking missing requirement remains inside the current Task 008 boundary after the packet correction. The reviewed task contract now explicitly limits this slice to doctor status and remediation for `AC-05`, and no reviewed implementation/test gap remains against that narrower contract: [openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:66](openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:66), [openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:67](openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:67), [openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/context.json:33](openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/context.json:33).

## Extra Behavior

- The current implementation goes slightly beyond the minimal doctor slice by adding explicit remediation and repair surfaces, not just passive status reporting. Specifically, doctor now emits plugin-repair, environment-repair, install, and repair actions, and the kernel also includes a transactional `repairRuntime(...)` path that preserves the previous runtime and restores it on failed replacement: [plugins/specnav-verification/kernel/runtime/doctor.js:217](plugins/specnav-verification/kernel/runtime/doctor.js:217), [plugins/specnav-verification/kernel/runtime/doctor.js:241](plugins/specnav-verification/kernel/runtime/doctor.js:241), [plugins/specnav-verification/kernel/runtime/doctor.js:248](plugins/specnav-verification/kernel/runtime/doctor.js:248), [plugins/specnav-verification/kernel/runtime/doctor.js:522](plugins/specnav-verification/kernel/runtime/doctor.js:522), [plugins/specnav-verification/kernel/runtime/repair.js:21](plugins/specnav-verification/kernel/runtime/repair.js:21). This extra behavior is consistent with the updated report and does not conflict with `AC-05`, but it is broader than a read-only fact probe.

## Misunderstood Requirements

- No current misunderstanding remains in the task packet. The earlier review issue was not an implementation defect in doctor logic; it was an over-broad acceptance binding that incorrectly attached `AC-28` to a doctor-only slice. That misunderstanding has been corrected in the task packet and planning artifacts, and the code now aligns with the clarified scope: [openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:67](openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:67), [openspec/changes/verification-2-0/development/task-graph.json](openspec/changes/verification-2-0/development/task-graph.json), [openspec/changes/verification-2-0/development/task-context.jsonl](openspec/changes/verification-2-0/development/task-context.jsonl).

## Cannot Verify From Diff

- The diff and focused receipts are sufficient for `AC-05`, but they still do not prove downstream consumers beyond this slice. In particular, this review does not verify that execution preflight, blocked report rendering, or release/archive gates consume doctor output correctly, because those responsibilities were intentionally moved to Tasks `013`, `016`, and `033`: [openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:67](openspec/changes/verification-2-0/development/tasks/008-runtime-doctor/brief.md:67), [openspec/changes/verification-2-0/development/task-context.jsonl](openspec/changes/verification-2-0/development/task-context.jsonl). This is a scope note, not a defect against Task 008’s current acceptance target.

## Acceptance Assertions Verified

- `AC-05`: met.
  Direct implementation evidence:
  [plugins/specnav-verification/kernel/runtime/doctor.js:185](plugins/specnav-verification/kernel/runtime/doctor.js:185) resolves one exact runtime and returns `blocked` with `fallback_used: false` on every failure path.
  [plugins/specnav-verification/kernel/runtime/doctor.js:217](plugins/specnav-verification/kernel/runtime/doctor.js:217) reports lock corruption and incompatible runtime identity as exact blockers and now emits explicit remediation actions.
  [plugins/specnav-verification/kernel/runtime/doctor.js:288](plugins/specnav-verification/kernel/runtime/doctor.js:288) reports `verification-runtime:runtime-missing` with an explicit install action instead of silently selecting another runtime.
  [plugins/specnav-verification/kernel/runtime/doctor.js:325](plugins/specnav-verification/kernel/runtime/doctor.js:325) reports corrupt or missing install receipts.
  [plugins/specnav-verification/kernel/runtime/doctor.js:363](plugins/specnav-verification/kernel/runtime/doctor.js:363) reports corrupt or missing package locks plus package-lock integrity mismatch.
  [plugins/specnav-verification/kernel/runtime/doctor.js:387](plugins/specnav-verification/kernel/runtime/doctor.js:387) reports package lock-entry mismatch and package load failure for exact package names.
  [plugins/specnav-verification/kernel/runtime/doctor.js:427](plugins/specnav-verification/kernel/runtime/doctor.js:427) reports browser receipt mismatch, missing marker, missing executable, permission denial, and probe failure per browser.
  [plugins/specnav-verification/kernel/runtime/doctor.js:508](plugins/specnav-verification/kernel/runtime/doctor.js:508) distinguishes warning versus blocker for Midscene provider configuration based on `requiresMidscene`.
  [plugins/specnav-verification/scripts/verification-runtime.js:54](plugins/specnav-verification/scripts/verification-runtime.js:54) exposes the doctor CLI path and returns non-zero on blocked readiness without performing install or fallback.
  [plugins/specnav-verification/kernel/runtime/repair.js:21](plugins/specnav-verification/kernel/runtime/repair.js:21) provides explicit repair behavior while preserving the prior runtime and restoring it on failed replacement.

  Direct focused-test evidence:
  [tests/verification-v2/runtime/doctor.test.js:177](tests/verification-v2/runtime/doctor.test.js:177) proves a ready runtime with provider redaction and no secret leakage.
  [tests/verification-v2/runtime/doctor.test.js:213](tests/verification-v2/runtime/doctor.test.js:213) proves optional versus required Midscene provider handling.
  [tests/verification-v2/runtime/doctor.test.js:244](tests/verification-v2/runtime/doctor.test.js:244) proves exact install action when the locked runtime is absent.
  [tests/verification-v2/runtime/doctor.test.js:266](tests/verification-v2/runtime/doctor.test.js:266) proves explicit remediation for corrupt locks and incompatible environments.
  [tests/verification-v2/runtime/doctor.test.js:309](tests/verification-v2/runtime/doctor.test.js:309) proves blockers for tampered locks, missing browsers, and unloadable packages.
  [tests/verification-v2/runtime/doctor.test.js:348](tests/verification-v2/runtime/doctor.test.js:348) proves permission and receipt identity blockers.
  [tests/verification-v2/runtime/doctor.test.js:380](tests/verification-v2/runtime/doctor.test.js:380) proves explicit runtime repair command for installed-runtime corruption.
  [tests/verification-v2/runtime/doctor.test.js](openspec/changes/verification-2-0/development/evidence/033-008-runtime-doctor.log:1) plus the final repair test prove repair preserves the previous runtime and restores it if replacement fails.

  System-executed evidence:
  [openspec/changes/verification-2-0/development/evidence/027-008-runtime-doctor-red.log:1](openspec/changes/verification-2-0/development/evidence/027-008-runtime-doctor-red.log:1) preserves the RED state where `doctor.js` was missing.
  [openspec/changes/verification-2-0/development/evidence/032-008-runtime-doctor.log:1](openspec/changes/verification-2-0/development/evidence/032-008-runtime-doctor.log:1) records the full `task008-quality-fix1` wrapper pass, including ready-runtime JSON plus 8 focused doctor tests.
  [openspec/changes/verification-2-0/development/evidence/033-008-runtime-doctor.log:1](openspec/changes/verification-2-0/development/evidence/033-008-runtime-doctor.log:1) records the focused `doctor.test.js` pass with all 8 subtests green.
  [openspec/changes/verification-2-0/development/evidence/034-008-runtime-doctor.log:1](openspec/changes/verification-2-0/development/evidence/034-008-runtime-doctor.log:1) records syntax verification for `doctor.js`, `repair.js`, and `verification-runtime.js`.
  [openspec/changes/verification-2-0/development/validation-log.jsonl:54](openspec/changes/verification-2-0/development/validation-log.jsonl:54) through [openspec/changes/verification-2-0/development/validation-log.jsonl:62](openspec/changes/verification-2-0/development/validation-log.jsonl:62) show the claimed and passed system-executed receipts for both the original review set and the later quality-fix set, all non-overturned.

## Independent Re-Run

- `bash tests/run-verification-runtime-doctor.sh`
- `node --test tests/verification-v2/runtime/doctor.test.js`

Both commands passed in the current working tree during this re-review.

## Findings

- No remaining Task 008 spec defect was found after the acceptance binding was corrected to `AC-05` only.
- The prior `needs-fix` verdict is superseded by the updated task packet plus the new `032-034` system receipts.

## Required Fixes

- No blocking fix is required for Task 008 itself. The only remaining work is outside this task’s accepted slice: downstream tasks that own execution gating and release/archive behavior must continue to prove their own contracts against the doctor status/remediation output, but that is not a reopen condition for this review.
