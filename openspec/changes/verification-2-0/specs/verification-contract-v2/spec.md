## ADDED Requirements

### Requirement: Versioned verification entities
The system SHALL define and validate versioned schemas for cases, approvals,
snapshots, runs, attempts, readings, evidence, indexes, failures, runtime
status, reports, gates, and migration receipts.

#### Scenario: Invalid entity is rejected
- **WHEN** an artifact omits a required identity field or uses an unsupported schema version
- **THEN** validation fails with the exact artifact path and field blocker

#### Scenario: Valid entity is accepted
- **WHEN** an artifact satisfies its declared schema and cross-reference rules
- **THEN** validation returns the normalized entity and schema version

### Requirement: Immutable execution identity
The system MUST bind every attempt to the active change, approved case snapshot,
run, case, attempt kind, code SHA, test SHA, scenario hash, environment hash,
browser project, and test data snapshot.

#### Scenario: Retry identity changes
- **WHEN** a retry changes any immutable execution fingerprint
- **THEN** the system rejects retry classification and requires a retest or new run

### Requirement: Explicit case approval
The system MUST prevent execution until a reviewer explicitly approves the
current case snapshot hash.

#### Scenario: Cases changed after approval
- **WHEN** a case, step, assertion, domain mapping, runner, or evidence policy changes after approval
- **THEN** prior approval becomes stale and execution is blocked pending reapproval

### Requirement: No simplified verification contract
The system MUST apply Verification Contract V2 to every standard, full, and
otherwise simplified product change.

#### Scenario: Light change enters verification
- **WHEN** a change classified as light reaches verification
- **THEN** the system requires the full V2 approval, execution, evidence, report, and archive contract
