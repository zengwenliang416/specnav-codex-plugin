## ADDED Requirements

### Requirement: Trusted reading-level failure root
The repair-loop state machine SHALL accept a terminal initial attempt whose
runner status is `passed` when a trusted classification envelope binds a
schema-valid failed or blocked reading packet to the exact run, case, and
attempt.

#### Scenario: Runner passes and deterministic reading fails
- **WHEN** the initial runner attempt and its trusted attempt fact are `pass`, and the trusted classifier binds failed reading and assertion identifiers to that attempt
- **THEN** repair-loop evaluation continues through the normal repair, retest, and regression lifecycle

### Requirement: Attempt truth remains immutable
The repair-loop state machine MUST preserve the runner attempt status and
attempt-fact verdict while representing a separate reading-level failure.

#### Scenario: Caller changes a passed attempt fact to fail
- **WHEN** a passed initial attempt is supplied with an attempt fact whose verdict is `fail`
- **THEN** evaluation is blocked for attempt-fact status mismatch

### Requirement: Existing trust boundary remains mandatory
The repair-loop state machine MUST reject unsigned, unverified, incorrectly
bound, or schema-invalid classification and attempt facts before accepting a
reading-level failure root.

#### Scenario: Classification authority is forged
- **WHEN** a caller supplies a reading-level failure classification that does not pass trusted-envelope verification
- **THEN** evaluation remains blocked and no transition proposal is produced
