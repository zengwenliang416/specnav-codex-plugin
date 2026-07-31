## ADDED Requirements

### Requirement: Explicit managed runtime installation
The system SHALL install the locked Verification Runtime only after an explicit
user action and only under
`~/.specnav/runtime/verification/<version>/`.

#### Scenario: Clean installation
- **WHEN** the user invokes runtime installation for a supported version
- **THEN** the system installs locked packages and browsers and writes a verifiable install receipt

#### Scenario: Business repository remains unchanged
- **WHEN** runtime installation completes
- **THEN** the business repository package manifest and lockfiles remain unchanged

### Requirement: Required runtime components
The runtime MUST include locked compatible versions of `@playwright/test`,
`playwright`, Playwright browser binaries, `@midscene/web`, and `ajv`.

#### Scenario: Required component missing
- **WHEN** runtime doctor cannot resolve a required package or browser binary
- **THEN** it reports the exact missing component and blocks cases that require it

### Requirement: Runtime doctor
The system SHALL report Node compatibility, package integrity, browser
availability, provider configuration status, filesystem permission, runtime
version, and kernel compatibility.

#### Scenario: Midscene case lacks provider configuration
- **WHEN** an approved case requires Midscene and provider configuration is absent
- **THEN** doctor returns a model-configuration blocker and the case does not execute

### Requirement: No runtime fallback
The system MUST NOT silently use moving `npx` packages, global packages, an
unverified browser, or a different runtime version after doctor failure.

#### Scenario: Locked runtime is unavailable
- **WHEN** the required runtime version is absent or invalid
- **THEN** verification blocks and names the explicit install or repair command
