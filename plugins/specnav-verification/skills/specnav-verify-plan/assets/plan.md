# Verification Plan: {{SPECNAV_CHANGE}}

## Verification Scope

- Active change: `{{SPECNAV_CHANGE}}`
- Development handoff: `openspec/changes/{{SPECNAV_CHANGE}}/development/handoff-to-verify.md`

## Required Domains

1. Facticity
2. Static
3. Unit
4. Redteam
5. E2E
6. Sensory

## Evidence Plan

- Direct repository evidence beats summaries.
- Every green verdict requires command, file, runtime, screenshot, trace, or
  review evidence.
- Missing evidence is a blocker, not a warning.
- `verify/runtime-evidence.json` must record runtime and browser execution
  evidence. If `development/migrations/manifest.json` has `required=true`, it
  must also record database evidence.

## User-Aligned Test Case Gate

- Generate `verify/user-test-cases.md` and `verify/user-test-cases.json` from
  requirements, acceptance, prototype handoff, development tasks, and handoff.
- Ask the user to approve, edit, remove, or add cases.
- Freeze approval in `verify/user-test-case-signoff.json`.
- Map every approved case across all six domains in
  `verify/domain-case-matrix.json`.
- Six-domain verification is blocked until the signoff status is `approved`.

## Runtime Evidence Gate

- Start the application or relevant service and record the command, output,
  logs, or health check under the `runtime` surface.
- Run the approved user test cases in a real browser or equivalent automation
  and record screenshots, traces, or transcripts under the `browser` surface.
- When migrations are required, run database verification queries and record
  them under the `database` surface.
- A green domain report without matching runtime evidence is invalid.
