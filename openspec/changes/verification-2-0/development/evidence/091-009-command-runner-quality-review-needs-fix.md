# Independent Quality Review Evidence: 009-command-runner

Recorded at: 2026-07-31T13:39:49Z

Verdict: `needs_fix`

## Reproduced Defect

When timeout fires first and abort arrives before child `close`, the command
adapter returns both:

```text
timed_out: true
canceled: true
```

The orchestrator then classifies the attempt as canceled because cancellation
is evaluated before timeout. This loses the first terminal cause and reports a
timeout failure as user cancellation.

## Verified Clean

- Blocked terminal event ordering is now complete.
- `artifact_valid: false` does not invent terminal artifacts.
- Returned and callback event streams match.
- Logs, blockers, cwd containment, spawn gates, retry history, and input
  immutability remain intact.

The review was read-only. No implementation files were edited by the reviewer.
