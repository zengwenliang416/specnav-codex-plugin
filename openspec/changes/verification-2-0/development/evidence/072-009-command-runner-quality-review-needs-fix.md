# Task 009 Quality Review: Needs Fix

Independent quality review reproduced four defects in the live worktree:

1. Approved repository-local cwd symlinks can resolve outside the project.
2. Abort or timeout between child `exit` and `close` can misclassify an
   exit-status-zero command.
3. Terminal schema rejection returns blocked top-level state with running
   run/attempt entities.
4. Returned deep-freeze recursively freezes caller-owned previous attempts.

The existing focused suite passed 21/21 and the full Verification V2 suite
passed 187/187, demonstrating that these adverse paths were missing from the
test contract. Task 009 remains incomplete until focused regressions fail
before repair, pass after repair, and independent quality review approves.
