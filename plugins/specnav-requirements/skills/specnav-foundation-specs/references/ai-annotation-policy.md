# L3 AI Annotation Policy (optional)

The L3 annotation layer is an **opt-in** extension to foundation specs. It is not
part of the required foundation set and is absent by default. Adopt it when a
project wants AI agents to reason more accurately about specific code seams.

## When to adopt

- Long, multi-module code paths where agents repeatedly re-derive the same seam.
- Code the team has seen agents misread (a bad-case root cause pointing at a seam).
- Before a `gate` decision, run advisory first and watch the coverage trend.

## Create the policy

```
node "$SPECNAV_REQUIREMENTS_ROOT/skills/specnav-foundation-specs/scripts/create-annotation-policy.js"
```

This writes `openspec/specs/ai-annotation-policy/design.md` with
`enforcement: advisory`. Edit it to set `anchor_pattern`, `seam_globs`, and (when
ready) `enforcement: gate`.

## How it is validated and consumed

- `foundation-specs.js validateAnnotationPolicy(root)` — absent → no blocker;
  present-but-malformed → `invalid-annotation-policy:*`. Folded into the
  requirements gate only when the file exists.
- `verification/scripts/anchor-scan.js` — reads `enforcement`, `anchor_pattern`,
  and `seam_globs`; scans touched in-scope files; writes
  `verify/static/anchor-report.json` and an `anchor.coverage` event. Blocks with
  `anchor-uncovered:<file>` only under `enforcement: gate`.

## Governance stance

Advisory-by-default and measure-before-you-gate. This mirrors the repo's
anti-list rule: do not expand mandatory gates until effectiveness is measured.
`enforcement: gate` is a deliberate per-project opt-in, never automatic.
