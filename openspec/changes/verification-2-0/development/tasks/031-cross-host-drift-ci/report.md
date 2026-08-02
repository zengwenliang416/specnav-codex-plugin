# Task Report: 031-cross-host-drift-ci

## Status

COMPLETE

## Delivered Slice

Release owners can run one fail-closed compatibility check across Codex,
Claude Code, and CodeFree-O. CI compares the shared Kernel identity, source
tree, schemas, blocker registry, normalized fixtures, report model, host
architecture boundaries, synchronized tree ownership, host wrapper bytes, and
clean immutable source provenance before release.

## What Changed

- Added a versioned compatibility snapshot and cross-host drift comparator.
- Treated downstream JavaScript as untrusted data: candidate metadata is parsed
  without `require()`, and fixtures use the trusted local canonicalizer.
- Added stable missing/invalid/unsafe manifest blockers, exact synchronized
  file-set checks, required host-file checks, and host/transformed-file digest
  verification.
- Added source provenance enforcement for `source_dirty=false` and an exact
  locked source commit.
- Hardened Claude synchronization to rebuild from an empty staging tree,
  preserve only the declared plugin runtime and plugin manifest inputs, remove
  legacy `.gitkeep` residue, and validate the complete output tree.
- Added immutable host locks and a dedicated GitHub Actions drift job.
- Added Codex, Claude Code, and CodeFree-O adapter contracts to the cross-host
  runner and included that runner in root `npm test`.

## Repository Checkpoints

- Canonical source: `e07b343483886ad5d13b84bcd79b164a3a3e0fbb`
- Claude Code host: `35d188be4f188b84f261760226ca174af0785870`
- CodeFree-O host: `72527bd25e47d3b39dc6b94c092d2f917ce7d048`

## TDD Evidence

- `441` preserves the initial missing-API RED.
- `443` preserves manifest path traversal RED.
- `444` preserves unversioned Kernel source drift RED.
- `449` preserves the independent-review RED: 11/15 passed and four governance
  gaps remained.
- `450` passes all 51 cross-host adapter, synchronizer, provenance, manifest,
  architecture, and drift tests.
- `451` passes all 542 Verification 2.0 tests, including real Playwright.
- `452` passes root `npm test`.
- `453` passes Claude smoke and CodeFree-O tests, discovery, and doctor.
- `454` passes syntax, workflow YAML, and three-repository diff validation.
- `456` preserves the trusted-provenance bypass RED.
- `457` passes all 54 cross-host tests after trusted provenance is recomputed.
- `458` preserves the full-suite RED caused by the Kernel governance boundary
  classification.
- `459` through `463` pass root smoke, downstream host validation, syntax,
  documentation, and README contracts.
- `464` passes all 548 Verification 2.0 tests after the governance boundary is
  classified without exporting host-specific control-plane code.

## Verification Commands

- `bash tests/run-verification-v2-cross-host.sh`
- `node --test $(find tests/verification-v2 -type f -name '*.test.js' | sort)`
- `npm test`
- Claude Code `tests/run-smoke.sh`
- CodeFree-O `npm test`, `npm run test:codefree`, and doctor
- Node syntax, GitHub Actions YAML, and scoped `git diff --check`

## Concerns

- GitHub Actions execution against remote immutable commits cannot occur until
  the already-authorized local checkpoints are eventually pushed; local tests
  validate the workflow contract and exact locked commits without claiming a
  remote CI run.

## Scope Deviations

- The generated packet omitted the synchronization writers and root smoke
  entry needed to close the independent-review findings.
- `scope-correction.json` records the bounded additive file set and preserves
  the rule that CI detects drift but never synchronizes downstream hosts.

## Follow-up Needed

- Task 033 consumes this compatibility proof for final release and archive
  governance.

## Adjudication

Receipt `449` remains append-only and is explicitly overturned by `450`; no
failed evidence was removed or rewritten.

Receipt `456` remains append-only and is explicitly overturned by `457`.
Receipt `458` remains append-only and is explicitly overturned by `464`.
