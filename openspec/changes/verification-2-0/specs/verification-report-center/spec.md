## ADDED Requirements

### Requirement: Three report pages
The system SHALL generate `overview.html`, `test-case-catalog.html`, and
`test-case-results.html` from one validated report model.

#### Scenario: Verification is blocked before execution
- **WHEN** runtime, approval, or evidence prerequisites are blocked
- **THEN** all three pages render the blocked state and exact next actions

### Requirement: Complete result history
The results page MUST show every run, attempt, reading, evidence item, failure
classification, repair link, retest, and regression result.

#### Scenario: Failure is repaired
- **WHEN** a case passes after a repair
- **THEN** the results page shows both failed and passing evidence and labels PASS AFTER FIX

### Requirement: Shared information architecture
The system MUST use the same navigation, status vocabulary, and evidence-link
behavior for green, red, blocked, running, canceled, stale, flaky, and
pass-after-fix reports.

#### Scenario: Verdict changes after rerun
- **WHEN** a new run changes the aggregate verdict
- **THEN** report structure remains stable and only fact-derived state changes

### Requirement: Evidence link integrity
The report renderer MUST show evidence integrity and freshness and MUST NOT
create a valid-looking link to a missing artifact.

#### Scenario: Evidence is missing
- **WHEN** report data references missing evidence
- **THEN** the page shows a broken-evidence blocker and no green integrity badge

### Requirement: Accessible responsive report
The report center SHALL support desktop, mobile, keyboard navigation, semantic
tables, accessible status text, and print output.

#### Scenario: Mobile review
- **WHEN** a reviewer opens any report page at a mobile viewport
- **THEN** controls and result content remain readable without overlap or hidden verdicts

### Requirement: Report is not source of truth
Release and archive gates MUST read validated JSON/JSONL artifacts rather than
trusting rendered HTML.

#### Scenario: HTML is manually edited to green
- **WHEN** a user changes the rendered HTML verdict
- **THEN** gate output remains unchanged and follows source artifacts
