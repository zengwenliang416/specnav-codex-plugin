## ADDED Requirements

### Requirement: Shared Verification Kernel
Codex, Claude Code, and CodeFree-O MUST consume the same versioned Verification
Kernel for schemas, state transitions, evidence integrity, aggregation,
freshness, report models, and gate decisions.

#### Scenario: Host adapter is tested
- **WHEN** the shared fixture corpus runs through any supported host adapter
- **THEN** normalized artifacts, blocker ids, and verdicts match the kernel contract

### Requirement: Thin host adapters
Host-specific code SHALL be limited to manifest, skill, hook, configuration
lookup, command invocation, and presentation concerns.

#### Scenario: Host adapter redefines aggregation
- **WHEN** a host adapter contains domain or release aggregation logic
- **THEN** the architecture check fails and requires extraction into the kernel

### Requirement: Cross-host drift detection
The system SHALL detect kernel version, schema, blocker, fixture, and generated
artifact drift before release.

#### Scenario: One host uses an older schema
- **WHEN** host installation evidence reports a different required kernel or schema version
- **THEN** compatibility validation blocks release

### Requirement: Explicit V1-to-V2 migration
The system MUST provide dry run, backup, transformation, validation, receipt,
and rollback for legacy verification artifacts.

#### Scenario: Legacy green has missing evidence
- **WHEN** migration encounters a passing V1 report without provable evidence
- **THEN** the migrated V2 reading is blocked and requires rerun

### Requirement: Clean installation verification
Each host repository MUST prove GitHub installation/discovery, plugin
availability, runtime setup/doctor, and a fixture verification run before
release.

#### Scenario: Plugin files exist but host discovery fails
- **WHEN** a repository checkout contains plugin code but the host does not expose the plugin
- **THEN** installation verification fails and release is blocked

### Requirement: Release and archive governance
Operations MUST require fresh V2 verification, generated reports, successful
cross-host compatibility, and completed migration before release or archive.

#### Scenario: Codex passes but another supported host fails
- **WHEN** Claude Code or CodeFree-O compatibility remains red or blocked
- **THEN** the shared release remains blocked
