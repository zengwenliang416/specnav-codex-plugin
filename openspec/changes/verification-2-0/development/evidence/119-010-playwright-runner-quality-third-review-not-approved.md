# Independent Quality Third Review: 010-playwright-runner

## Verdict

NOT APPROVED

## Findings

1. CRITICAL: `allow default` plus a write-only denial did not prevent an
   escaped scenario from reading host files or using direct network access.
2. HIGH: the Chromium scratch regex permitted an escaped scenario to create
   arbitrary matching paths outside adapter-owned staging.
3. HIGH: process-group termination did not prevent a scenario from first
   creating a detached child in a new process group.

## Confirmed Repairs

- Ordinary project-external writes were denied.
- Artifact staging and publication no longer followed a replaced destination
  symlink.
- Cancellation and first-stop-cause tests remained green.
- Raw capture versus Task 014 redaction ownership remained explicit.

## Required Fix

Use a default-deny process profile, move the trusted managed browser process
outside the hostile scenario boundary, allow the scenario process to connect
only as a client, deny host project reads, remove host-temp write exceptions,
and deny process creation so detached descendants cannot escape terminal
shutdown.
