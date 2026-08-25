## 1. Contract

- [x] 1.1 Add artifact-loss review and authority schemas.
- [x] 1.2 Add trusted producer, claims, payload validation, and host action.

## 2. Runtime

- [x] 2.1 Add approval-gated append-only artifact-loss recording.
- [x] 2.2 Route verified artifact loss only to Core `route_break_loop`.
- [x] 2.3 Preserve the existing normal integrity path unchanged.

## 3. Verification

- [x] 3.1 Add schema, authority, state-machine, CLI, and host-adapter tests.
- [x] 3.2 Prove forged or conflicting input fails closed.
- [x] 3.3 Prove Playwright network safety files are unchanged.
- [x] 3.4 Install locally, run real project evaluation, and confirm no failure
  is marked green.

## 4. Closure

- [x] 4.1 Record executed commands and results.
- [x] 4.2 Commit locally without push.
