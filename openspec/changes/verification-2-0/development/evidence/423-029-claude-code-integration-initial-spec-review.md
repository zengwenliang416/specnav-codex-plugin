# Initial Specification Review: 029-claude-code-integration

## Verdict

needs-fix

## Findings

- The focused runner executed the upstream integration wrapper but did not
  directly execute the adapter installed in `specnav-claude-plugin`.
- The generated task allowlist omitted the shared host adapter extraction and
  related canonical files required by AC-40.
- Task report, specification review, quality review, and lifecycle state were
  still scaffolds.

## Required Repairs

- Execute downstream `claude-verification-adapter.js` directly and prove a
  full source-command invocation, not only file and route discovery.
- Correct the task scope before accepting the shared extraction.
- Complete system-executed evidence and task lifecycle artifacts before
  checkbox closure.

Reviewer agent: `019fc236-ee82-7a33-afc0-50292596dc71`
