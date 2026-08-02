# Spec Review: 032-docs-install-runtime

## Verdict

approved

## Missing Requirements

- None found in the documentation content.

## Extra Behavior

- None. The guides document existing Verification 2.0 and host adapter
  contracts; they do not introduce runtime behavior.

## Misunderstood Requirements

- None.

## Cannot Verify From Diff

- Live GitHub installation on all three remote hosts remains part of Task 033.
  Task 032 verifies the commands, documented artifact paths, and aligned
  guidance without claiming a remote installation run.

## Acceptance Assertions Verified

- `AC-04`: both guides define locked external runtime installation and explicit
  approval for mutation.
- `AC-05`: both guides enumerate runtime doctor blockers for Node, packages,
  browsers, provider configuration, locks, and permissions.
- `AC-08`: both guides define `verify/reports/overview.html` and its readiness,
  six-domain, blocker, freshness, integrity, repair, and release content.
- `AC-09`: both guides define the approved-case catalog report.
- `AC-10`: both guides define the case-results report with runs, attempts,
  readings, evidence, hashes, freshness, and repair history.

## Required Fixes

- None.

## Review Evidence

- `462-032-docs-install-runtime.log`: documentation contract 3/3.
- `463-032-docs-install-runtime.log`: README contract 1/1.
- Independent rereview found no remaining specification gap.
