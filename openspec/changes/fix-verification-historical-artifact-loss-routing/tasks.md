## 1. Contract

- [ ] 1.1 Add artifact-loss review and authority schemas.
- [ ] 1.2 Add trusted producer, claims, payload validation, and host action.

## 2. Runtime

- [ ] 2.1 Add approval-gated append-only artifact-loss recording.
- [ ] 2.2 Route verified artifact loss only to Core `route_break_loop`.
- [ ] 2.3 Preserve the existing normal integrity path unchanged.

## 3. Verification

- [ ] 3.1 Add schema, authority, state-machine, CLI, and host-adapter tests.
- [ ] 3.2 Prove forged or conflicting input fails closed.
- [ ] 3.3 Prove Playwright network safety files are unchanged.
- [ ] 3.4 Install locally, run real project evaluation, and confirm no failure
  is marked green.

## 4. Closure

- [ ] 4.1 Record executed commands and results.
- [ ] 4.2 Commit locally without push.
