# Independent Quality Review: 010-playwright-runner

## Verdict

NOT APPROVED

## Findings

1. HIGH: `artifact_root` has a time-of-check/time-of-use escape. The adapter
   validates the directory once, exposes it to the scenario, and later writes
   screenshots, trace, video, console, network, and assertion files through
   the original path. Replacing the directory with an external symlink after
   validation writes artifacts outside the project while the run reports
   `passed`.
2. HIGH: timeout and cancellation do not stop scenario logic. The adapter wins
   a `Promise.race()` but leaves the scenario promise alive, so delayed Node
   side effects can occur after a terminal `failed` or `canceled` result.
3. MEDIUM: console and network captures are raw and may contain configured
   secrets. Task 014 owns persisted evidence redaction; Task 010 must not claim
   secret-safe evidence or a final integrity verdict.

## Independent Validation

- Browser and runtime focused suites passed 33/33.
- Command, case, and contract regressions passed 148/148.
- A targeted path-escape reproduction wrote browser artifacts to an external
  directory while returning `passed`.
- A targeted cancellation reproduction wrote a delayed marker after the
  adapter had returned `canceled`.

## Required Fixes

- Capture artifacts in an adapter-owned private staging directory and publish
  them atomically without exposing the staging path to scenario code.
- Execute scenario code in an isolatable boundary that can be terminated and
  awaited before returning a terminal result.
- Keep raw capture versus downstream redaction ownership explicit.
