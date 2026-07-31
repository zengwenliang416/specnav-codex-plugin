# Verification 2.0 Gap Analysis

## Baseline

The current verification contract checks artifact presence and selected field
shapes, but it does not establish a complete identity and integrity chain from
an approved test case to a final reading.

`tests/verification-v2/baseline/cases.json` records thirteen isolated V1 states
that are currently accepted as green and must become blocked under
Verification 2.0, plus red and blocked-domain rendering baselines.

## Confirmed Fake-Green Paths

| Gap | Current V1 behavior | Required V2 behavior |
| --- | --- | --- |
| Missing acceptance snapshot | Verification can be green when `acceptance.json` is absent. | Require an approved, immutable acceptance and case snapshot. |
| Empty domain evidence | A green domain report may contain empty `evidence` and `commands`. | Require validated readings and evidence for every required assertion. |
| Missing evidence file | Evidence paths are not required to exist. | Verify containment, existence, size, producer, and binding. |
| Tampered evidence | Evidence content has no required hash or size comparison. | Block on content hash or size mismatch. |
| Stale code binding | Evidence may name any code SHA without comparison to the run. | Block when code or test identity does not match the attempt. |
| Unknown producer | Evidence producer identity is not constrained. | Accept only registered deterministic, browser, AI-interaction, or human-review producers. |
| Broken references | Evidence may point to missing cases or steps. | Validate run, case, attempt, step, and assertion references as one identity chain. |
| Missing runtime artifacts | Runtime and browser references are accepted as strings. | Probe artifacts and bind them to a real attempt. |
| Manual green report | A green domain report can override a blocked structured reading. | Derive domain and release verdicts only from validated readings. |
| mtime-only freshness | Touching report files can clear stale state. | Use code, test, scenario, environment, and case fingerprints. |
| Unverified green HTML | HTML reflects the superficial aggregate verdict. | Render only from a validated report model and show blockers. |
| Incomplete report center | V1 renders one aggregate page for green, red, and blocked-domain states. | Generate overview, case catalog, and immutable result pages for every state. |

## Delivery Consequence

The baseline is not a production fix. Tasks 002 through 026 must progressively
turn these cases into explicit V2 blockers while preserving the original
failed evidence and attempts.

No task may remove a baseline case because the new implementation is
inconvenient. A case is closed only when the V2 gate blocks it for the intended
reason and the legacy fixture suite still passes.
