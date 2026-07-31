## ADDED Requirements

### Requirement: Unified execution orchestrator
The system SHALL execute approved cases through registered command, Playwright,
or Midscene adapters using one run and attempt lifecycle.

#### Scenario: Adapter execution completes
- **WHEN** a registered adapter executes a case
- **THEN** it emits structured lifecycle events, a terminal attempt, readings, logs, and evidence references

### Requirement: Deterministic final oracle
The system MUST require a Playwright assertion, structured API or database fact,
deterministic comparison, or explicit policy-allowed human signoff for a final
PASS.

#### Scenario: Midscene reports success without assertion
- **WHEN** Midscene describes the expected UI but no deterministic or approved human oracle exists
- **THEN** the reading remains blocked and cannot aggregate to PASS

### Requirement: Immutable evidence storage
The system SHALL store evidence as append-only raw records plus
content-addressed files and a rebuildable summary index.

#### Scenario: Failed attempt is followed by success
- **WHEN** a later retry or retest passes
- **THEN** all failed attempt records and evidence remain available and linked in results

### Requirement: Evidence integrity
The system MUST verify evidence path containment, existence, size, hash,
producer, run/case/attempt/step binding, code/test SHA, and freshness.

#### Scenario: Evidence file is changed
- **WHEN** a referenced evidence file no longer matches its recorded hash or size
- **THEN** the associated reading becomes blocked and the release gate cannot be green

#### Scenario: Evidence reference is fake
- **WHEN** a report references a path that does not exist
- **THEN** integrity validation reports a broken-evidence blocker

### Requirement: Secret-safe evidence
The system MUST redact configured secret patterns from logs and reports without
removing the structural evidence required for diagnosis.

#### Scenario: Provider token appears in process output
- **WHEN** captured stdout or stderr contains a configured secret
- **THEN** persisted evidence and HTML contain a redacted marker instead of the secret
