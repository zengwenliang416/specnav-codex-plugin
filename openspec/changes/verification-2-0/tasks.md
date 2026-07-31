# Tasks: verification-2-0

## 1. Baseline And Kernel Boundary

User Outcome: Maintainers can reproduce false-green paths and install one shared host-neutral kernel.

- [x] 1.1 Maintainer can reproduce every current fake-green acceptance path with failing V2 fixtures.
- [x] 1.2 Maintainer can install one shared Verification Kernel package without host-specific verdict logic.

## 2. Verification Contract V2

User Outcome: Reviewers can validate immutable, internally consistent test contracts before execution.

- [x] 2.1 Plugin author can validate every V2 entity through versioned JSON Schemas.
- [x] 2.2 Reviewer can reject artifacts whose run, case, attempt, step, or SHA references disagree.
- [ ] 2.3 Reviewer can approve an immutable test-case snapshot before execution starts.

## 3. Managed Verification Runtime

User Outcome: Verification operators can install and diagnose one exact managed runtime without fallback.

- [x] 3.1 Verification operator can resolve an exact runtime version from a committed lock manifest.
- [x] 3.2 Verification operator can explicitly install Playwright, browsers, Midscene, and AJV outside the business repository.
- [x] 3.3 Verification operator can diagnose runtime readiness and receive exact blockers without fallback.

## 4. Execution Adapters

User Outcome: Reviewers can execute command, Playwright, and Midscene cases with trustworthy evidence.

- [ ] 4.1 Reviewer can execute command-backed cases and inspect structured attempts, logs, and exit evidence.
- [ ] 4.2 Reviewer can execute Playwright cases with assertions, traces, screenshots, video, console, and network evidence.
- [ ] 4.3 Reviewer can use Midscene for UI interaction while deterministic or human-approved oracles retain final verdict ownership.

## 5. Evidence And Readings

User Outcome: Reviewers can inspect append-only, integrity-checked, redacted evidence and assertion readings.

- [ ] 5.1 Reviewer can retain append-only evidence objects and rebuild the summary index without losing failed attempts.
- [ ] 5.2 Release owner can see missing, tampered, stale, or incorrectly bound evidence block green.
- [ ] 5.3 Reviewer can inspect redacted logs and HTML without provider secrets leaking.
- [ ] 5.4 Reviewer can inspect expected, actual, oracle, and evidence for every assertion reading.

## 6. Six-Domain Evaluation

User Outcome: Release owners can receive derived six-domain verdicts and explicitly approved not-applicable decisions.

- [ ] 6.1 Release owner can receive six-domain and release verdicts derived only from validated case readings.
- [ ] 6.2 Reviewer can approve a domain as not applicable only with reason and evidence.

## 7. Failure Repair Loop

User Outcome: Developers and reviewers can classify, repair, retest, regress, and close failures without losing evidence.

- [ ] 7.1 Maintainer can classify failures into product, test, environment, flaky, blocker, or requirement categories.
- [ ] 7.2 Developer can receive a scoped repair task linked to frozen verification failure evidence.
- [ ] 7.3 Reviewer can distinguish retry, retest, and regression and close a failure only after required regression passes.

## 8. Freshness And Impact Reruns

User Outcome: Reviewers can identify stale cases and rerun the exact impacted cases plus mandatory baselines.

- [ ] 8.1 Reviewer can see case freshness derived from SHA and execution fingerprints instead of mtime.
- [ ] 8.2 Verification operator can rerun concrete impacted cases plus mandatory baselines using CodeGraph and policy evidence.

## 9. Report Center

User Outcome: Stakeholders can review lifecycle, case, result, evidence, and repair state in accessible HTML reports.

- [ ] 9.1 Stakeholder can receive one validated report model for all three report pages and every verdict state.
- [ ] 9.2 Stakeholder can review lifecycle readiness, six domains, blockers, freshness, integrity, and repair status in overview.html.
- [ ] 9.3 Stakeholder can review approved case contracts in test-case-catalog.html and immutable attempt evidence in test-case-results.html.
- [ ] 9.4 Stakeholder can use desktop, mobile, keyboard, print, and escaped secret-safe report pages.

## 10. Migration

User Outcome: Maintainers can migrate or roll back V1 artifacts without manufacturing a V2 PASS.

- [ ] 10.1 Maintainer can dry-run, back up, migrate, validate, and roll back V1 verification artifacts without fake PASS.

## 11. Host Integrations

User Outcome: Codex, Claude Code, and CodeFree-O users can run the same Verification Kernel through native adapters.

- [ ] 11.1 Codex user can discover and run Verification 2.0 through the Codex marketplace adapter.
- [ ] 11.2 Claude Code user can discover and run the same Verification Kernel through the Claude plugin adapter.
- [ ] 11.3 CodeFree-O user can discover and run the same Verification Kernel without losing existing local installation fixes.

## 12. Cross-Host Quality And Documentation

User Outcome: Users can detect host drift and follow matched English and Chinese installation and operation guidance.

- [ ] 12.1 Release owner can detect cross-host kernel, schema, blocker, fixture, and generated-artifact drift in CI.
- [ ] 12.2 User can install, configure, diagnose, and review Verification 2.0 from matched English and Chinese documentation.

## 13. Release And Archive Proof

User Outcome: Release owners can prove clean installation, six-domain evidence, reports, and archive readiness across every host.

- [ ] 13.1 Release owner can prove clean GitHub installation, full six-domain evidence, three reports, and archive readiness across all hosts.
