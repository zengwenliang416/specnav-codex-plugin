# Task Report: 031-cross-host-drift-ci

## Status

IMPLEMENTED_AWAITING_FINAL_REVIEW

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

- Canonical source: `c92d7e88d7978d7942368fbac2d0779be9e17466`
- Claude Code host: `df3134f08fab0af6026fdf1e6f8d2de96d346f6b`
- CodeFree-O host: `403f14d3ecfb49fa3b8c32d65a151abbe6974002`

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

## Verification Commands

- `bash tests/run-verification-v2-cross-host.sh`
- `node --test $(find tests/verification-v2 -type f -name '*.test.js' | sort)`
- `npm test`
- Claude Code `tests/run-smoke.sh`
- CodeFree-O `npm test`, `npm run test:codefree`, and doctor
- Node syntax, GitHub Actions YAML, and scoped `git diff --check`

## Concerns

- Final independent specification and quality/security reviews are in progress.
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

- Record both final independent review verdicts.
- Only after approval, mark Task 12.1 complete and run lifecycle maintenance.

## Adjudication

Receipt `449` remains append-only and is explicitly overturned by `450`; no
failed evidence was removed or rewritten.
