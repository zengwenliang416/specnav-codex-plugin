## ADDED Requirements

### Requirement: Six-domain coverage
The system MUST map every approved case to facticity, static, unit, redteam,
E2E, and sensory evaluation.

#### Scenario: Domain mapping is missing
- **WHEN** an approved case lacks a terminal mapping for any domain
- **THEN** verification remains blocked

### Requirement: Approved not applicable
The system SHALL allow `not_applicable` only with a reason, evidence, reviewer,
approval timestamp, and policy permission.

#### Scenario: Agent skips a domain
- **WHEN** an agent writes `not_applicable` without approval and evidence
- **THEN** the domain remains blocked

### Requirement: Reading-derived aggregation
The system MUST derive case, domain, and release verdicts from validated
readings and intact evidence.

#### Scenario: Manual green report has no readings
- **WHEN** a domain report says passed but required readings or evidence are absent
- **THEN** aggregation ignores the manual verdict and returns blocked or failed

### Requirement: Terminal verdict semantics
The system SHALL distinguish PASS, FAIL, BLOCKED, FLAKY, PASS AFTER FIX, STALE,
CANCELED, and approved NOT APPLICABLE.

#### Scenario: Retry passes without changes
- **WHEN** an initial attempt fails and an identical-fingerprint retry passes
- **THEN** the case is labeled FLAKY instead of ordinary PASS

#### Scenario: Retest passes after repair
- **WHEN** code or tests change after a classified repair and the retest passes
- **THEN** the case is labeled PASS AFTER FIX and regression remains required

### Requirement: Full verification gate
The system MUST require all approved cases and six domains to reach policy-valid
terminal states before release or archive.

#### Scenario: Simple change has only static and unit results
- **WHEN** a simple change lacks facticity, redteam, E2E, or sensory decisions
- **THEN** release and archive remain blocked
