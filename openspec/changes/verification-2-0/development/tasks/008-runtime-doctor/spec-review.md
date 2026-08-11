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

- AC-05

## Independent Re-Run

- `bash tests/run-verification-runtime-doctor.sh`
- `node --test tests/verification-v2/runtime/doctor.test.js`

Both commands passed in the current working tree during this re-review.

## Findings

- No remaining Task 008 spec defect was found after the acceptance binding was corrected to `AC-05` only.
- The prior `needs-fix` verdict is superseded by the updated task packet plus the new `032-034` system receipts.

## Required Fixes

- No blocking fix is required for Task 008 itself. The only remaining work is outside this task’s accepted slice: downstream tasks that own execution gating and release/archive behavior must continue to prove their own contracts against the doctor status/remediation output, but that is not a reopen condition for this review.
