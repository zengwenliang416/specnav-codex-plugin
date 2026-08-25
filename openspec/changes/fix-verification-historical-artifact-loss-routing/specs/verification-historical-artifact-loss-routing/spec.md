## ADDED Requirements

### Requirement: Historical artifact loss is explicit authority

The Runtime SHALL record irrecoverable historical run artifact loss only as a
signed, append-only `historical_artifact_loss` fact bound to a human-approved
review, a signed classification envelope, and a byte-addressed recovery audit.

#### Scenario: Approved irrecoverable loss is recorded

- **WHEN** the exact failure, run, case, attempt, classification envelope, audit
  digest, and missing artifact paths match
- **AND** every declared historical artifact remains absent
- **THEN** the Runtime appends one replay-safe authority envelope
- **AND** it does not create or modify any historical run, attempt, reading,
  evidence, integrity, or attempt-fact artifact

#### Scenario: Review or artifact state differs

- **WHEN** the review, reviewer, classification digest, audit digest, path
  boundary, or current artifact presence differs
- **THEN** the Runtime blocks without appending authority

### Requirement: Artifact loss can only route to break loop

The repair-loop state machine SHALL interpret a verified
`historical_artifact_loss` fact only as a Core-owned
`route_break_loop` proposal.

#### Scenario: Artifact loss is evaluated

- **WHEN** the signed classification and artifact-loss authority facts match
  the same failure
- **THEN** the state is `break_loop_required`
- **AND** the proposal action is `route_break_loop`
- **AND** no attempt integrity claim is synthesized

#### Scenario: Caller mixes artifact loss with normal repair history

- **WHEN** artifact-loss authority is supplied with runs, attempts,
  attempt-facts, repair authority, or rerun authority
- **THEN** the state machine blocks

### Requirement: Network safety is invariant

The change SHALL NOT modify Playwright network or browser execution policy.
