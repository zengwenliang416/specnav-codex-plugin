## 1. Contract

- [x] 1.1 Add generation review and signed activation schemas.
- [x] 1.2 Add append-only generation authority and frozen inventory checks.

## 2. Execution

- [x] 2.1 Add explicit `generation_id` binding to new runs.
- [x] 2.2 Block execution without a current approved generation.
- [x] 2.3 Reject retry/retest/regression lineage crossing generations.

## 3. Finalization

- [x] 3.1 Scope integrity, freshness, aggregation, failure state, and gates to
  the active generation.
- [x] 3.2 Build a generation-scoped evidence authority.
- [x] 3.3 Disclose prior open failures as historical warnings.

## 4. Host Contract

- [x] 4.1 Add generation review and approval-required activation actions.
- [x] 4.2 Document the successor generation workflow.

## 5. Verification

- [x] 5.1 Prove approval and baseline drift fail closed.
- [x] 5.2 Prove only post-activation runs count.
- [x] 5.3 Prove historical `break_loop` remains immutable and disclosed.
- [x] 5.4 Prove current-generation evidence and failure defects still block.
- [x] 5.5 Prove fallback, manual green, and Playwright network restrictions are
  unchanged.

## 6. Closure

- [ ] 6.1 Install Runtime locally and run real project generation review.
- [ ] 6.2 Activate only after exact user approval, rerun all approved cases,
  and require owning `finalize` to return `ok:true`.
- [ ] 6.3 Commit locally without push.
