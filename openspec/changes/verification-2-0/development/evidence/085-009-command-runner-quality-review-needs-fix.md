# Independent Quality Review Evidence: 009-command-runner

Recorded at: 2026-07-31T13:29:36Z

Verdict: `needs_fix`

## Reproduced Defect

Both post-execution contract-blocked branches preserve command output and
blockers, but their ordered event streams omit `attempt.terminal` and
`run.terminal`.

For a schema-valid synthetic blocked terminal, returned run and attempt state
are terminal while the events stop at:

```text
command.terminal
execution.contract-blocked
```

If both terminal candidates are rejected, no terminal artifact may be invented,
but the event stream still needs an explicit terminal transition whose payload
states that the artifact is unavailable.

## Review Commands

- `node --test tests/verification-v2/execution/command-adapter.test.js`
  -> passed, 28 tests.
- `node --test tests/verification-v2/**/*.test.js`
  -> passed, 194 tests.
- `git diff --check`
  -> passed.
- Two targeted live probes reproduced the event gap.

The review was read-only. No implementation files were edited by the reviewer.
