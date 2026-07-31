# Task 010 Quality Review: IPC Result Forgery

Verdict: NOT APPROVED

The sandboxed scenario can recover the child process object and call
`process.send()` directly. The parent accepted any child IPC object with
`type: result`, so scenario code could send a forged passing terminal result
before its real failing assertion executed.

Confirmed impact:

```json
{
  "ok": true,
  "status": "passed",
  "assertions": [],
  "blockers": [],
  "stdout": "forged"
}
```

Required fix:

- Authenticate child event/result messages with a parent-generated nonce.
- Deliver the nonce after process spawn through IPC, not through the payload,
  environment, artifacts, or logs.
- Capture the trusted IPC sender before scenario execution.
- Ignore unauthenticated event/result messages.
- Preserve the real assertion result and terminal state.
