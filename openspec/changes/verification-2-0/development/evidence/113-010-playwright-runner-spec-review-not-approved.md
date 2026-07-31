# Independent Specification Review: 010-playwright-runner

## Verdict

NOT APPROVED

## Findings

1. The happy-path browser assertion is not deterministic. The test clicks the
   load button and immediately reads `#status` without waiting for the
   asynchronous fetch and DOM update. Independent runs produced both pass and
   `playwright-assertion-failed`, and a cold run also reached the 10-second
   timeout.
2. The live diff includes a Task 015 dependency correction outside the Task 010
   implementation allowlist. The dependency was added to the graph and context
   but omitted from Task 015's `stop_condition`.

## Positive Boundary Findings

- The adapter requires `fallback_used === false`.
- The adapter launches only the doctor-approved managed runtime executable.
- The task does not produce downstream Reading, integrity, aggregation,
  release, or archive verdicts.

## Independent Validation

- Focused test passed in one serial run, with the happy path taking 8697 ms.
- The focused shell runner produced one failure and one pass on separate runs.
- A cold minimal reproduction timed out under 10000 ms and passed under 30000
  ms.

## Required Fixes

- Wait for the observable asynchronous UI state before asserting it.
- Separate the Task 015 dependency correction from Task 010 implementation and
  make its dependency declarations internally consistent.
