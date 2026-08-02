# Verification 2.0 User Test Case Review

## User Test Case Scope

- Snapshot ID: `snapshot-5be49e798f6b94dcb4822a60`
- Snapshot SHA-256: `5be49e798f6b94dcb4822a608397cf097a336cc73a319dd69aca25549bc48f5a`
- Supersedes unapproved snapshots: `snapshot-8275e3773c02cde842362ae2`,
  `snapshot-a18241eab51c454d56b5f369`,
  `snapshot-a29c5899fe1661cd2ad9991b`
- Requirements: 7
- Acceptance assertions: 40
- Test cases: 8
- Required domains per case: facticity, static, unit, redteam, e2e, sensory
- Approval status: `pending`

Approval applies only to this exact snapshot ID and SHA-256. Any case, step,
assertion, domain mapping, runner, evidence policy, requirement, or acceptance
change invalidates approval and requires a new snapshot.

## Aligned Test Cases

### CASE-01: Case Planning And Approval Gate

- Actor: verification reviewer
- Goal: inspect the complete contract and prove that neither execution nor a
  simplified path can bypass exact-snapshot human approval.
- Runner: `bash tests/run-verification-v2-case-approval.sh`
- Acceptance: `AC-01`, `AC-02`, `AC-03`
- Evidence: assertion results and command output, retained on failure and
  content-addressed.

### CASE-02: Managed Runtime And Runner-Oracle Boundaries

- Actor: verification operator
- Goal: prove locked runtime diagnosis, immutable attempt identity, explicit
  adapters, deterministic final oracles, and no fallback.
- Runner: `bash tests/run-verification-v2-codex.sh`
- Acceptance: `AC-04`, `AC-05`, `AC-14`, `AC-15`, `AC-16`
- Evidence: assertion results, command output, and structured comparisons.

### CASE-03: Evidence, Readings, Six Domains, And Freshness

- Actor: quality reviewer
- Goal: prove that only intact evidence produces readings and that six-domain,
  freshness, rerun, and release decisions are fact-derived.
- Runner: `bash tests/run-smoke.sh`
- Acceptance: `AC-13`, `AC-17` through `AC-24`, `AC-31`, `AC-35`
- Evidence: append-only command output, assertion results, and structured
  comparisons.

### CASE-04: Failure And Repair Loop

- Actor: developer and verification operator
- Goal: preserve failures while governing classification, repair, retry,
  retest, regression, closure, reopen, and break-loop escalation.
- Runner: `bash tests/run-verification-v2-repair-loop.sh`
- Acceptance: `AC-06`, `AC-07`, `AC-25`, `AC-26`, `AC-27`, `AC-32`
- Evidence: immutable failure and attempt history plus structured assertions.

### CASE-05: Three-Page Report Center

- Actor: stakeholder reviewer
- Goal: review overview, catalog, and results pages across all states with
  accessible, responsive, print-safe, escaped, and secret-safe presentation.
- Runner: `bash tests/run-verification-v2-report-browser.sh`
- Acceptance: `AC-08` through `AC-12`, `AC-29`, `AC-30`, `AC-38`
- Evidence: real Playwright test results, screenshots, command output, and the
  browser artifact manifest.

### CASE-06: V1-To-V2 Migration

- Actor: migration operator
- Goal: migrate legacy artifacts with dry-run, backup, receipt, validation,
  rollback, and fail-closed missing-evidence semantics.
- Runner: `bash tests/run-verification-v2-migration.sh`
- Acceptance: `AC-33`, `AC-34`
- Evidence: command output and structured migration comparisons.

### CASE-07: Shared Kernel And Three-Host Integration

- Actor: plugin maintainer
- Goal: prove one host-neutral kernel and thin synchronized Codex, Claude Code,
  and CodeFree-O adapters with drift detection.
- Runner: `bash tests/run-verification-v2-cross-host.sh`
- Acceptance: `AC-36`, `AC-37`, `AC-39`, `AC-40`
- Evidence: host fixture results, architecture checks, and drift assertions.

### CASE-08: Release And Archive Gate

- Actor: release owner
- Goal: release and archive only when complete fresh V2 evidence, reports,
  migration, and all host proofs are green.
- Runner: `bash tests/run-verification-v2-release.sh`
- Acceptance: `AC-03`, `AC-28`, `AC-29`, `AC-33`, `AC-35`, `AC-37`
- Evidence: gate identity, negative fixtures, archive transaction, and rollback
  assertions.

## Domain Mapping

Every aligned case is mapped to all six required domains in
`verify/domain-case-matrix.json`. No domain is marked `not_applicable`.

## User Signoff

Choose one:

- `approve`: approve this exact snapshot and allow six-domain execution.
- `edit`: list case changes; a new snapshot and SHA-256 will be generated.
- `reject`: stop Verification 2.0 execution.
