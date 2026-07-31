# Acceptance Criteria: verification-2-0

## User-Visible Criteria

- `AC-01` A reviewer can inspect all proposed test cases, steps, assertions,
  six-domain mappings, runner choices, and evidence requirements before any
  case executes.
- `AC-02` Verification is blocked until the current case snapshot has explicit
  user approval.
- `AC-03` Every change follows the full Verification 2.0 gate; no request can
  select a light, compact, or simplified verification path.
- `AC-04` The runtime setup command installs the locked Verification Runtime
  outside the business repository and shows exact installed versions and
  browser status.
- `AC-05` Runtime doctor reports missing Node, packages, browser binaries,
  Midscene provider configuration, corrupt locks, and permission failures as
  exact blockers.
- `AC-06` A reviewer can see first failure, retry, repair, retest, and regression
  attempts without earlier evidence being overwritten.
- `AC-07` A retry that passes is labeled `FLAKY`; a repaired case that passes is
  labeled `PASS AFTER FIX`.
- `AC-08` `overview.html` shows lifecycle readiness, six-domain status, blocker
  counts, freshness, integrity, repair-loop state, and release verdict.
- `AC-09` `test-case-catalog.html` shows the approved case contract and domain
  coverage.
- `AC-10` `test-case-results.html` shows runs, attempts, readings, commands,
  evidence, hashes, freshness, and repair history.
- `AC-11` Green, red, blocked, running, canceled, stale, flaky, and
  pass-after-fix reports share the same navigation and information hierarchy.
- `AC-12` Report pages work on desktop and mobile, are keyboard operable, and
  preserve verdict/evidence information in print output.

## System Criteria

- `AC-13` Versioned schemas validate test cases, approvals, snapshots, runs,
  attempts, readings, evidence, indexes, failures, runtime, reports, and gates.
- `AC-14` Every attempt is bound to change id, case id, run id, attempt id, code
  SHA, test SHA, scenario hash, environment hash, browser project, and test data
  snapshot.
- `AC-15` Retry is rejected when any retry identity fingerprint changes.
- `AC-16` Midscene output cannot produce PASS without a deterministic assertion,
  structured fact, or explicit human signoff.
- `AC-17` Missing evidence files, hash mismatch, size mismatch, stale SHA,
  unrecognized producer, or broken case/step references block green.
- `AC-18` Empty evidence arrays, empty verification commands, or a manually
  edited green domain report cannot produce green.
- `AC-19` All six domains receive a terminal result for every approved case.
- `AC-20` `not_applicable` requires a reason, evidence, reviewer identity,
  approval timestamp, and policy allowance.
- `AC-21` Domain status and release verdict are derived from case readings; no
  domain skill or agent prose can override the aggregate.
- `AC-22` Raw evidence is append-only, the summary index is rebuildable, and
  cache loss does not lose source truth.
- `AC-23` Case-level freshness uses SHA/fingerprints rather than mtime alone.
- `AC-24` Rerun scope returns concrete affected case ids and reasons, not only
  domain names.
- `AC-25` A failed case creates a frozen failure packet and routes product/test
  repair to a standard development task packet.
- `AC-26` Regression scope includes the repaired case, directly impacted cases,
  and policy-required baseline cases.
- `AC-27` Repeated no-progress repair attempts route to break-loop governance
  instead of silently retrying.
- `AC-28` Release and archive block on unapproved cases, incomplete readings,
  stale/tampered evidence, open failures, missing reports, or red/blocked gates.
- `AC-29` Reports generate for green, red, and blocked states and never become
  the source of truth.
- `AC-30` HTML rendering escapes artifact content and never exposes provider
  secrets.

## Data Criteria

- `AC-31` Evidence records contain stable id, kind, path, hash, size, producer,
  timestamp, change, run, case, attempt, step/assertion, code SHA, and test SHA.
- `AC-32` Failed evidence is retained after retry, repair, migration, report
  regeneration, release, and archive.
- `AC-33` V1-to-V2 migration provides dry-run output, backup references,
  migration receipt, validation results, and rollback instructions.
- `AC-34` Migration never interprets missing V1 evidence as V2 PASS.
- `AC-35` Gate decisions name source case readings, evidence index version,
  runtime version, kernel version, and freshness result.

## Component Criteria

- `AC-36` One host-neutral Verification Kernel owns schemas, state transitions,
  evidence integrity, aggregation, freshness, and report model semantics.
- `AC-37` Codex, Claude Code, and CodeFree-O adapters pass the same kernel
  contract and fixture suite.
- `AC-38` Shared report components are reused across all three HTML pages.
- `AC-39` Playwright, Midscene, command execution, EvidenceStore, failure
  classification, and report rendering use explicit adapter/service boundaries.
- `AC-40` Duplicate verification logic across host repositories is removed or
  replaced by generated/synchronized kernel consumption with drift detection.

## Verification Surfaces

- Facticity: schemas, artifact existence, content hashes, ids, SHA bindings,
  migration receipts, runtime receipts, and cross-host checksums.
- Static: syntax, lint-like contract scans, JSON Schema validation, forbidden
  dependency scans, secret scans, and HTML escaping checks.
- Unit: pure state machine, policy, aggregation, integrity, freshness, rerun
  scope, classifier, and report-model tests.
- Redteam: forged evidence, path traversal, stale SHA, overwritten attempts,
  prompt/log injection, model-only PASS, fake `not_applicable`, and manual green
  report attempts.
- E2E: managed runtime setup/doctor, real Playwright run, optional Midscene
  interaction with deterministic oracle, failure-to-repair-to-regression loop,
  report generation, release gate, and archive gate.
- Sensory: desktop/mobile/print report review, accessibility, visual hierarchy,
  complete blocked/red states, and evidence readability.

## Exit Criteria

- All forty acceptance criteria have direct verification evidence.
- All six domains are terminal and green for the change.
- Codex, Claude Code, and CodeFree-O integration suites pass.
- Managed runtime installation and doctor are proven on a clean fixture.
- The real browser integration test produces and validates all three reports.
- No V1 compatibility path can bypass V2 integrity or approval gates.

## Unresolved Gaps

- None.
