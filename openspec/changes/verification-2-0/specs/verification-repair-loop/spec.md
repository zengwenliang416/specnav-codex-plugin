## ADDED Requirements

### Requirement: Failure classification
The system SHALL classify a failed reading as product defect, test defect,
environment defect, flaky behavior, expected blocker, or requirement ambiguity.

#### Scenario: Failure has no classification
- **WHEN** a required reading fails
- **THEN** the system creates a failure packet and blocks closure until classification is recorded

### Requirement: Repair ownership boundary
Verification MUST own failure evidence and closure, Development MUST own
product/test code repair, and Core MUST own lifecycle transitions.

#### Scenario: Product defect requires code changes
- **WHEN** a failure is classified as a product defect
- **THEN** verification creates a development repair handoff referencing frozen failure evidence

### Requirement: Repair baseline and scope proof
The system MUST record a clean signed repair baseline before product or test
source changes and MUST verify the completed Git diff against the approved
repair scope.

#### Scenario: Repair changes a file outside approved scope
- **WHEN** the baseline-to-reviewed Git diff contains an unapproved, denied, deleted, or renamed file
- **THEN** repair completion is blocked and no completed repair fact is signed

### Requirement: Retry retest and regression separation
The system MUST record retry, retest, and regression as distinct attempt kinds
with distinct eligibility rules.

#### Scenario: Code changes before rerun
- **WHEN** product or test code changes after failure
- **THEN** the next execution is a retest or regression and never a retry

### Requirement: Regression closure
The system MUST keep a failure open until the repaired case and required
regression scope pass with fresh evidence.

#### Scenario: Repaired case passes but regression fails
- **WHEN** retest passes and any required regression case fails
- **THEN** the failure loop reopens and release remains blocked

### Requirement: Break-loop governance
The system SHALL route repeated no-progress repair cycles to the existing
break-loop process.

#### Scenario: Same failure repeats without new evidence
- **WHEN** the configured no-progress threshold is reached
- **THEN** automatic repair stops and a break-loop decision artifact is required
