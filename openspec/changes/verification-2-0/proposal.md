## Why

SpecNav currently exposes six verification domains, but green status can still
be assembled from weak references, empty evidence, manual domain summaries, and
domain-level reruns. It also lacks a complete failure-to-repair lifecycle and a
managed Playwright/Midscene runtime, so the same verification request can behave
differently across Codex, Claude Code, and CodeFree-O.

Verification is the release trust boundary. It must become a full,
evidence-backed lifecycle with no simplified mode and no silent fallback.

## What Changes

- **BREAKING** Replace light/static-unit verification with the full Verification
  2.0 gate for every change.
- Add versioned contracts for cases, approval, snapshots, runs, attempts,
  readings, evidence, failures, reports, and gates.
- Add an explicit managed runtime under
  `~/.specnav/runtime/verification/<version>/` with locked Playwright,
  Playwright browsers, Midscene, and AJV.
- Add command, Playwright, and Midscene runner adapters behind one execution
  orchestrator.
- Require deterministic or explicitly human-approved final oracles; Midscene or
  agent prose cannot independently declare PASS.
- Add an append-only EvidenceStore with hashes, identity binding, freshness,
  integrity checks, and a rebuildable summary index.
- Derive all six domain verdicts and release readiness from approved case
  readings.
- Add a preserved retry/retest/regression repair loop with failure packets and
  development handoff.
- Replace domain-only rerun scope and mtime freshness with case-level impact and
  SHA/fingerprint freshness.
- Generate `overview.html`, `test-case-catalog.html`, and
  `test-case-results.html` for green, red, and blocked states.
- Extract one host-neutral Verification Kernel and integrate it into Codex,
  Claude Code, and CodeFree-O through thin adapters.
- Add explicit V1-to-V2 migration, negative fixtures, real browser integration,
  documentation, and release/archive governance.

## Capabilities

### New Capabilities

- `verification-contract-v2`: Versioned test-case, execution, evidence, failure,
  report, and gate data contracts.
- `managed-verification-runtime`: Explicit installation, version locking,
  browser management, configuration checks, and runtime doctor.
- `evidence-backed-execution`: Runner orchestration, deterministic oracle
  boundary, immutable evidence, integrity, and freshness.
- `six-domain-evaluation`: Case-to-domain mapping, explicit not-applicable
  approval, deterministic aggregation, and release verdict.
- `verification-repair-loop`: Failure classification, retry, repair, retest,
  regression, and break-loop coordination.
- `verification-report-center`: Shared report model and three-page HTML review
  site for every verification state.
- `cross-host-verification-governance`: Shared kernel delivery, host adapters,
  migration, drift prevention, CI, and archive governance.

### Modified Capabilities

- None. Existing project-level foundation specs constrain the new capabilities
  but do not define an existing Verification 2.0 capability.

## Impact

- Primary code: `plugins/specnav-verification`, `plugins/specnav-development`,
  `plugins/specnav-core`, `plugins/specnav-operations`, and shared kernel
  modules introduced by this change.
- Downstream repositories:
  `specnav-claude-plugin` and `specnav-codefree-o-plugin`.
- External runtime dependencies: Node.js 22, `@playwright/test`, `playwright`,
  Playwright browser binaries, `@midscene/web`, and `ajv`.
- Artifacts: new V2 files under
  `openspec/changes/<change>/verify/`; existing V1 artifacts require explicit
  migration.
- Operations: release and archive gates become stricter and require fresh,
  intact Verification 2.0 evidence and all three reports.
