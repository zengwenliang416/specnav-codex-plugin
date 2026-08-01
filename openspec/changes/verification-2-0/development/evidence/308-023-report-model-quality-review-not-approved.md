# Independent Quality And Security Review: 023-report-model

## Verdict

NOT_APPROVED

## Blockers

1. `aggregate` and `gate-decision` were accepted from caller-controlled input
   after only shape and self-recomputable digest checks. A caller could change a
   failed reading, submit a forged passing aggregate and gate, and receive a
   green report.
2. Evidence paths were copied directly into `href`. The common relative-path
   shape allowed a URI-like `javascript:` value, and the report builder did not
   require a trusted Evidence Index verification result.
3. Duplicate evidence ids were not rejected. The source id summary silently
   deduplicated the collision while both conflicting payloads remained in the
   result history.

## Required Fixes

- Require trusted aggregate and gate recomputation from the exact source
  readings, evidence, integrity, freshness, policy, and open-failure context.
- Require an explicit Evidence Index verifier with exact digest, version,
  count, and entry-id bindings.
- Generate evidence links through a controlled evidence locator and reject URI
  schemes, encoded traversal, unsafe segments, and non-object-store paths.
- Reject duplicate evidence ids before projection.
- Add adversarial regression tests for all three reproduced failures.

## Evidence

- Independent reviewer reproduced forged green, executable-looking evidence
  href, and duplicate-id history folding with read-only scripts.
- Existing focused tests passed 5/5 before these adversarial cases were added,
  proving the prior suite did not cover the trust boundary.
