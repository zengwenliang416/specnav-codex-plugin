# Development Handoff To Verify: verification-2-0

## Implemented Slices

- Versioned Verification 2.0 contracts, cross-reference validation, and
  baseline fake-green defenses.
- Managed runtime installation and doctor contracts for command, Playwright,
  and Midscene execution.
- Append-only evidence storage, integrity, freshness, redaction, and
  evidence-bound Reading derivation.
- Complete six-domain aggregation with approved `not_applicable` handling.
- Failure classification, development repair routing, retry, retest,
  regression, no-progress, and break-loop proposals.
- Three-page report center with shared components, responsive browser checks,
  print output, accessibility, escaping, CSP, and provenance.
- V1-to-V2 migration, Codex, Claude Code, CodeFree-O, cross-host drift, release,
  and transactional archive proof.

## Files Changed

- Canonical implementation: `plugins/specnav-verification/**`,
  `plugins/specnav-development/**`, and `plugins/specnav-operations/**`.
- Host synchronization and governance: `integrations/**`,
  `tests/verification-v2/cross-host/**`, and `.github/workflows/ci.yml`.
- Executable contracts: `tests/verification-v2/**` and
  `tests/run-verification-v2-*.sh`.
- Operator guidance: `README.md`, `README.zh-CN.md`, and
  `docs/verification-2-0*.md`.
- Lifecycle, review, and evidence artifacts under
  `openspec/changes/verification-2-0/development/**`.

## Requirements Covered

- All acceptance assertions `AC-01` through `AC-40` are marked passing in
  `acceptance.json` and bind to system-executed Verification 2.0 evidence.
- The final release/archive slice directly closes `AC-03`, `AC-28`, `AC-29`,
  `AC-33`, `AC-35`, and `AC-37` while consuming approved upstream evidence.
- No light, compact, partial-domain, fallback, or manual-green verification
  path is permitted.

## Prototype Decisions Implemented

- The approved three-page verification workspace is implemented as overview,
  case catalog, and case results projections.
- HTML remains a human-readable projection; Kernel JSON, Readings, evidence,
  aggregation, and DecisionEngine output remain verdict authority.
- Shared navigation, status vocabulary, report shell, responsive behavior, and
  immutable result presentation follow the approved prototype handoff.

## Components Created / Reused / Extracted

- One host-neutral Verification Kernel owns schemas, adapters, state machines,
  evidence, readings, aggregation, freshness, migration, reports, and gates.
- Shared command, Playwright, Midscene, EvidenceStore, report shell, and
  governance services are extracted behind explicit public boundaries.
- `verification-v2-proof.js` reuses the public Kernel aggregator and
  DecisionEngine instead of duplicating verdict semantics.
- `safe-filesystem.js/.py` and `archive-transaction.js` isolate reusable
  descriptor-relative I/O, no-follow safety, locking, snapshot, and rollback.

## API / Data Flow Changes

- Approved cases flow through managed runners into append-only evidence,
  integrity/freshness checks, Readings, six-domain aggregation, gate decisions,
  report models, and release/archive proof.
- Failed cases preserve the first failure and route through classification,
  repair task creation, reviewed code changes, focused retest, impacted
  regression, and close/reopen/break-loop proposals.
- Codex, Claude Code, and CodeFree-O consume synchronized Kernel contracts;
  immutable host locks and compatibility snapshots block cross-host drift.
- Release and archive recompute gate identity from `verify/v2/gate-input.json`
  and bind host receipts, migration, reports, and evidence-index digests.

## Tests Added

- 572 system-executed Verification 2.0 tests across contracts, runtime,
  execution, evidence, evaluation, repair, reports, migration, hosts, release,
  archive, security, and filesystem race defenses.
- 24 focused release/archive proof tests plus existing operations archive
  fixtures.
- Real Playwright browser, responsive, keyboard, print, and artifact checks.
- Codex smoke, Claude Code smoke and Operations fixtures, and CodeFree-O
  runtime, discovery, and doctor contracts.

## Local Validation

- `development/evidence/477-033-release-archive-proof.log`: 572/572 passed.
- `development/evidence/478-033-release-archive-proof.log`: release proof
  24/24 and archive fixtures passed.
- `development/evidence/479-033-release-archive-proof.log`: Codex smoke passed.
- `development/evidence/480-033-release-archive-proof.log`: Claude Code and
  CodeFree-O host checks passed.
- `development/evidence/481-033-release-archive-proof.log`: JavaScript, Python,
  shell syntax and all three repository diff checks passed.
- Independent specification and quality/security reviews are approved in
  evidence `482` and `483`.

## Known Risks

- Remote GitHub Actions has not run because the current authorization permits
  local checkpoint commits but no push.
- CodeGraph is not indexed in this repository. Under the current observe
  policy, `codegraph:not-indexed` and unverified claim warnings remain visible
  but do not replace system-executed Verification 2.0 evidence.
- Runtime provider availability and credentials remain environment-dependent;
  doctor and managed-runner blockers fail closed without fallback.

## Items Requiring Six-Domain Verification

- Verification 2.0 itself must now pass the full six-domain gate using the
  approved case snapshot; development completion does not self-authorize
  release.
- Release and archive must consume fresh, intact evidence, all three reports,
  closed repair state, successful migration proof when required, and distinct
  clean-host receipts.
- Any code, test, runtime, environment, case, or evidence identity change makes
  affected cases stale and requires the computed rerun and regression scope.
