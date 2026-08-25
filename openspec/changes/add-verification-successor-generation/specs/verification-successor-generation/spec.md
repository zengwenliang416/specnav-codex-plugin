## ADDED Requirements

### Requirement: Human-approved generation activation

The Runtime SHALL activate a successor verification generation only from an
exact review approved by the authenticated human reviewer.

#### Scenario: Missing approval blocks activation

- **WHEN** generation activation is requested without the approval boundary
- **THEN** no activation record is appended
- **AND** execution and finalization remain blocked

#### Scenario: Baseline drift blocks activation

- **WHEN** any snapshot, fingerprint, historical failure, or frozen baseline
  record differs from the approved review
- **THEN** activation fails closed
- **AND** the prior review and history remain unchanged

### Requirement: Explicit generation-bound execution

The Runtime SHALL bind every new verification run to the active generation.

#### Scenario: Execution before activation is rejected

- **WHEN** an approved case is executed without an active generation
- **THEN** the Runtime returns a generation-required blocker
- **AND** no run directory or projection record is created

#### Scenario: Pre-activation execution is excluded

- **WHEN** a passing run exists before generation activation
- **THEN** that run is preserved as history
- **AND** it does not satisfy any current-generation case

### Requirement: Generation-scoped Gate

The Runtime SHALL derive current freshness, integrity, aggregation, failure
state, Gate decisions, and report sources only from facts bound to the active
generation.

#### Scenario: Historical break-loop incidents do not block successor Gate

- **WHEN** the active generation has complete passing evidence
- **AND** prior generations contain immutable `break_loop` failures
- **THEN** the current Gate may pass
- **AND** the historical failures appear as non-green historical warnings

#### Scenario: Current generation defects still block

- **WHEN** the active generation contains missing evidence, integrity failure,
  stale execution, or an open failure
- **THEN** finalization blocks
- **AND** no fallback or manual green is available

### Requirement: Immutable baseline preservation

The Runtime SHALL verify that every fact frozen by the generation baseline
still exists with the same canonical digest.

#### Scenario: Historical mutation is detected

- **WHEN** a baseline run, attempt, execution, reading, failure, repair,
  evidence record, or authority envelope is modified or removed
- **THEN** execution and finalization block with baseline drift
- **AND** the Runtime does not repair or rewrite the altered history
