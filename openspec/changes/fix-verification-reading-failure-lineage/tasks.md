# Tasks: fix-verification-reading-failure-lineage

## 1. Scope And Reproduction

- [x] 1.1 Establish an isolated Runtime worktree and explicit repair scope.
- [x] 1.2 Confirm the installed Runtime state machine matches versioned source.
- [x] 1.3 Add a focused test that reproduces the passed-attempt reading failure blocker.

## 2. Runtime Repair

- [x] 2.1 Accept trusted reading-level failure lineage without changing attempt facts.
- [x] 2.2 Retain fail-closed behavior for forged classification and mismatched attempt facts.

## 3. Verification

- [x] 3.1 Run the focused repair-loop state-machine tests.
- [x] 3.2 Run the Verification 2.0 repair-loop suite.
- [x] 3.3 Validate the OpenSpec change and scope diff.
- [x] 3.4 Verify the original camera-rental failure produces the Core-owned regression transition.

## 4. Delivery

- [x] 4.1 Review the final diff for scope and network-policy invariants.
- [x] 4.2 Commit locally without push.
