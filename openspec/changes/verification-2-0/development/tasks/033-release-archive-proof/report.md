# Task Report: 033-release-archive-proof

## Status

DONE

## Files Changed

- `plugins/specnav-operations/scripts/verification-v2-proof.js`
- `plugins/specnav-operations/scripts/operations-gate.js`
- `plugins/specnav-operations/scripts/archive-change.js`
- `plugins/specnav-operations/scripts/archive-transaction.js`
- `plugins/specnav-operations/scripts/safe-filesystem.js`
- `plugins/specnav-operations/scripts/safe-filesystem.py`
- `tests/verification-v2/release/release-proof.test.js`
- `tests/verification-v2/release/safe-filesystem.test.js`
- `tests/verification-v2/release/populate-project.js`
- `tests/run-light-compact-gate-fixtures.sh`
- `tests/run-operations-archive-action-fixtures.sh`
- `tests/verification-v2/cross-host/host-lock.json`
- `docs/release-verification-v2.md`
- Task 033 lifecycle and evidence artifacts.

## What Changed

- Added a fail-closed release/archive proof that validates complete V2 input,
  reruns the shared six-domain aggregator and DecisionEngine, and compares
  recomputed release/archive identities with persisted gates.
- Bound all host installation receipts and the compatibility result to the
  current change, release gate, archive gate, gate-input SHA-256, and evidence
  index digest; duplicate hosts and replayed receipts fail closed.
- Added no-follow path handling for proof, evidence, archive candidates,
  registry, active-change, events, and receipt writes.
- Added a transactional archive snapshot and rollback for the original change,
  `openspec/specs`, registry, active-change, and events state.
- Added adversarial path escape, symlink, duplicate-host, replay, missing-domain
  forged-gate, evidence mutation, and rollback fixtures.
- Added direct and reused acceptance evidence. `AC-29` consumes Tasks 023-026;
  `AC-33` consumes Task 027.

## TDD Evidence

- `465` preserves the initial missing implementation RED and is repaired by
  `466`.
- `473` preserves the path escape, symlink, and duplicate-host review RED.
- `474` preserves the receipt replay review-fix RED.
- `477` passes the final full Verification 2.0 suite at 572/572.
- `478` passes the final release proof at 24/24 plus the archive action
  fixtures, including descriptor-relative ancestor-swap protection and
  owner-bound atomic archive locking.
- `479` passes the Codex root smoke, including cross-host 54/54, no simplified
  verification path, archive rollback, and release proof.
- `480` passes Claude Code smoke and Operations fixtures plus CodeFree-O 8/8,
  real discovery, and doctor.
- `481` passes JavaScript, Python, shell syntax and all three repository diff
  checks.
- `482` passes the final Development lifecycle maintenance contract with a
  zero-blocker handoff.

## Verification Commands

- `bash tests/run-verification-v2-release.sh`
- `bash tests/run-operations-archive-action-fixtures.sh`
- `bash tests/run-verification-v2-cross-host.sh`
- `npm test`
- `bash ../specnav-claude-plugin/tests/run-smoke.sh`
- `bash ../specnav-claude-plugin/tests/run-operations-plugin-fixtures.sh`
- CodeFree-O `npm test`, `npm run test:codefree`, and `npm run doctor`.
- `node --test $(find tests/verification-v2 -type f -name '*.test.js' | sort)`
- Node/Python/shell syntax and all three repository diff checks.

## Concerns

- Remote GitHub Actions cannot run until a future authorized push. The current
  task proves local immutable host locks and system-executed clean-host
  fixtures without claiming remote CI execution.

## Scope Deviations

- `scope-correction.json` records the additive release runner, archive fixture,
  immutable host-lock, parent acceptance/checkbox, and lifecycle-ledger files
  required to close the task.

## Follow-up Needed

- None for Task 033. Remote CI remains deferred until a future authorized push.

## Adjudication

Receipts `465`, `473`, and `474` remain append-only. Final adjudication records
bind them to later system-executed GREEN evidence; no failed evidence is
deleted or rewritten.
