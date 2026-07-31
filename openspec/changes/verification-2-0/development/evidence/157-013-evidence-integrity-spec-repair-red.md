# Task 013 Spec Repair RED Evidence

- Task: `013-evidence-integrity`
- Captured at: `2026-07-31`
- Command: `node --test tests/verification-v2/evidence/integrity.test.js`
- Exit status: `1`
- Result: `15` passed, `5` failed.

The failing tests proved:

- changes to `case_snapshot_hash`, `runtime_version`, or `kernel_version` did
  not make evidence stale;
- a missing EvidenceStore record was collapsed into the missing object-file
  blocker;
- stored evidence identity mismatch was collapsed into graph record mismatch.

The repair must compare the complete execution fingerprint and retain distinct
public blocker ids for each root cause.
